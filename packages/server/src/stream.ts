import {
  createApplicationRuntime,
  runWithApplicationRuntime,
  unregisterSubtree,
} from '@memoized-dom/runtime/server';
import {
  createMemoryRouteHistory,
  createRouteRuntime,
  runWithRouteRuntime,
} from '@memoized-dom/router';
import {
  prepareInitialRoutedRuntime,
  RoutedPreparationRedirectError,
  serializeRoutedPreparationState,
} from '@memoized-dom/router/internal';
import {
  createDataRuntime,
  runWithDataRuntime,
} from '@memoized-dom/data';
import { StringDocument, type StringRenderableNode } from './string-document';
import { createPayloadScriptTag, serverRootId } from './index';
import type { ServerComponent, RenderOptions, RenderPayload } from './index';

let streamSequence = 0;

export interface StreamOptions extends RenderOptions {
  /** Abort the render and all request-owned data work. */
  signal?: AbortSignal;
}

export interface PreparedRenderStream {
  readonly stream: ReadableStream<Uint8Array>;
  /** Settles after the complete server render succeeds or rejects. */
  readonly ready: Promise<void>;
}

async function waitWithSignal<T>(
  operation: PromiseLike<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) return operation;
  if (signal.aborted) {
    throw signal.reason ?? new Error('Streaming render aborted');
  }
  let abort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason ?? new Error('Streaming render aborted'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

/**
 * Render a compiled application as a Web stream.
 *
 * This is ordered, settled streaming—not suspense/out-of-order region
 * streaming. In `resolve` mode the host can flush its document prefix while
 * this stream settles request data, then pipe a fully resolved application
 * body followed by its state envelope. In `shell` mode the pending UI is
 * emitted immediately and no late replacement protocol is implied.
 */
function createRenderStream(
  component: ServerComponent,
  options: StreamOptions = {},
  settled?: {
    readonly resolve: () => void;
    readonly reject: (error: unknown) => void;
  },
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const signal = options.signal;
      if (signal?.aborted) {
        const reason = signal.reason ?? new Error('Streaming render aborted');
        controller.error(reason);
        settled?.reject(reason);
        return;
      }

      const stringDoc = new StringDocument();
      const runtime = createApplicationRuntime(`ssr-stream-${++streamSequence}`, {
        mode: 'server-string',
        document: stringDoc,
        schedule: null,
        effects: 'disabled',
        refs: 'disabled',
      });
      const routeRuntime = createRouteRuntime({
        routeHistory: createMemoryRouteHistory({
          initialEntries: [options.url ?? '/'],
        }),
      });
      const dataRuntime = createDataRuntime(
        options.fetch === undefined ? {} : { fetch: options.fetch },
      );
      const rootId = serverRootId(component);

      try {
        await runWithRouteRuntime(routeRuntime, () =>
          runWithDataRuntime(dataRuntime, () =>
            runWithApplicationRuntime(runtime, async () => {
              const preparation = await prepareInitialRoutedRuntime(
                routeRuntime,
                options.routedContext,
              );
              if (preparation.kind === 'redirect') {
                throw new RoutedPreparationRedirectError(preparation.redirect);
              }
              const root = component(rootId, null) as unknown as StringRenderableNode;

              if (options.mode === 'resolve') {
                await waitWithSignal(
                  dataRuntime.settle(options.timeout ?? 5000),
                  signal,
                );
              }

              let html = root.toString(options.markers === true);
              if (options.markers === true) {
                html = `<!--mmd:r:${rootId}-->${html}<!--/mmd-->`;
              }

              const state = dataRuntime.serializeState();
              const routed = serializeRoutedPreparationState(routeRuntime);
              const payload: RenderPayload = {
                version: 1,
                ...(state.sources.length > 0 ? { state } : {}),
                ...(routed === undefined ? {} : { routed }),
              };

              controller.enqueue(encoder.encode(html));
              if (options.markers === true) {
                controller.enqueue(
                  encoder.encode(createPayloadScriptTag(rootId, payload)),
                );
              }
              controller.close();
              settled?.resolve();
            }),
          ),
        );
      } catch (error) {
        runWithApplicationRuntime(runtime, () => unregisterSubtree(rootId));
        controller.error(error);
        settled?.reject(error);
      } finally {
        routeRuntime.dispose();
        dataRuntime.clear();
        runtime.dispose();
      }
    },
  });
}

/**
 * Prepare a stream and expose render completion to composed HTTP servers.
 *
 * `serve()` awaits `ready` before committing response headers so its
 * request error boundary can normalize both initial and data-settled render
 * failures. The public stream-only primitive retains its ordinary Web Stream
 * contract for custom hosts.
 */
export function prepareRenderToReadableStream(
  component: ServerComponent,
  options: StreamOptions = {},
): PreparedRenderStream {
  const settled = Promise.withResolvers<void>();
  const stream = createRenderStream(component, options, settled);
  return { stream, ready: settled.promise };
}

export function renderToReadableStream(
  component: ServerComponent,
  options: StreamOptions = {},
): ReadableStream<Uint8Array> {
  return createRenderStream(component, options);
}
