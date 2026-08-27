import {
  createApplicationRuntime,
  setActiveApplicationRuntime,
  runWithApplicationRuntime,
  unregisterSubtree,
} from '@memoized-dom/runtime';
import {
  createMemoryRouteHistory,
  createRouteRuntime,
  setActiveRouteRuntime,
  runWithRouteRuntime,
} from '@memoized-dom/router';
import {
  createDataRuntime,
  setActiveDataRuntime,
  runWithDataRuntime,
} from '@memoized-dom/data';
import { StringDocument, type StringRenderableNode } from './string-document';
import { createPayloadScriptTag } from './index';
import type { ServerComponent, RenderOptions, RenderPayload } from './index';

let streamSequence = 0;

export interface StreamOptions extends RenderOptions {
  /**
   * Signal to abort pending async work and terminate the stream early.
   */
  signal?: AbortSignal;
  /**
   * Timeout in milliseconds for pending asynchronous resources before closing.
   * Defaults to 10000ms.
   */
  timeout?: number;
}

/**
 * Renders a compiled application to a Web Standard `ReadableStream<Uint8Array>` (RFC §16.5 / Phase 6).
 *
 * Emits in chunks:
 * 1. Initial shell HTML with loading skeletons for fast TTFB (<1ms).
 * 2. As in-flight `$fetch` resources resolve, commits DOM mutations and emits companion state chunks.
 * 3. Final chunk containing the companion `<script type="application/mmd+json">` state envelope.
 */
export function renderToReadableStream(
  component: ServerComponent,
  options: StreamOptions = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      if (options.signal?.aborted) {
        controller.error(options.signal.reason);
        return;
      }

      const onAbort = () => {
        try {
          controller.error(options.signal?.reason ?? new Error('Streaming render aborted'));
        } catch {
          // controller might already be closed/errored
        }
      };

      options.signal?.addEventListener('abort', onAbort, { once: true });

      const stringDoc = new StringDocument();
      const runtime = createApplicationRuntime(`ssr-stream-${++streamSequence}`, {
        mode: 'server-string',
        document: stringDoc,
        schedule: null,
        effects: 'disabled',
        refs: 'disabled',
      });
      const previousRuntime = setActiveApplicationRuntime(runtime);
      const routeHistory = createMemoryRouteHistory({
        initialEntries: [options.url ?? '/'],
      });
      const routeRuntime = createRouteRuntime({ routeHistory });
      const dataRuntime = createDataRuntime(
        options.fetch === undefined ? {} : { fetch: options.fetch },
      );
      const previousRouteRuntime = setActiveRouteRuntime(routeRuntime);
      const previousDataRuntime = setActiveDataRuntime(dataRuntime);

      const rootId = 'App';

      try {
        await runWithRouteRuntime(routeRuntime, () =>
          runWithDataRuntime(dataRuntime, () =>
            runWithApplicationRuntime(runtime, async () => {
              if (options.signal?.aborted) {
                throw options.signal.reason;
              }

              // 1. Render initial shell synchronously
              const root = component(rootId, null) as unknown as StringRenderableNode;

              let initialHtml = root.toString(options.markers !== false);
              if (options.markers !== false) {
                initialHtml = `<!--mmd:r:${rootId}-->${initialHtml}<!--/mmd-->`;
              }

              // Emit initial shell chunk immediately for near-zero TTFB
              controller.enqueue(encoder.encode(initialHtml));

              // 2. Wait for asynchronous resources to settle if mode is 'resolve' or streaming
              const timeout = options.timeout ?? 10000;
              if (options.mode !== 'shell') {
                await dataRuntime.settle(timeout);
              }

              if (options.signal?.aborted) {
                throw options.signal.reason;
              }

              // 3. Serialize companion state envelope
              const state = dataRuntime.serializeState();
              const payload: RenderPayload = {
                version: 1,
                ...(state.sources.length > 0 ? { state } : {}),
              };

              const scriptTag = createPayloadScriptTag(rootId, payload);
              controller.enqueue(encoder.encode(scriptTag));

              options.signal?.removeEventListener('abort', onAbort);
              controller.close();
            }),
          ),
        );
      } catch (error) {
        options.signal?.removeEventListener('abort', onAbort);
        runWithApplicationRuntime(runtime, () => {
          unregisterSubtree(rootId);
        });
        try {
          controller.error(error);
        } catch {
          // ignore if already errored
        }
      } finally {
        setActiveApplicationRuntime(previousRuntime);
        setActiveRouteRuntime(previousRouteRuntime);
        setActiveDataRuntime(previousDataRuntime);
        routeRuntime.dispose();
        dataRuntime.clear();
        runtime.dispose();
      }
    },
  });
}
