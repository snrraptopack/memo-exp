import { stringTier, type StringRenderableNode } from './string-document';
import { createPayloadScriptTag } from './index';
import type { RenderOptions } from './index';
import type { ServerComponent } from './root-id';
import { RenderSession, type RenderSettlement } from './session';
import {
  RegionTracker,
  SourceDeltas,
  streamBootstrap,
  streamChunk,
  streamedState,
} from './stream-regions';

export interface PreparedRenderStream {
  readonly stream: ReadableStream<Uint8Array>;
  /**
   * Settles once route preparation (authentication gates, redirects, routed
   * data) has decided the response. Rejects with the redirect or failure.
   */
  readonly prepared: Promise<void>;
  /** Settles after the complete server render succeeds or rejects. */
  readonly ready: Promise<RenderSettlement>;
}

/**
 * Send the shell, then every region whose data settles, until the request
 * data is idle or the settle budget elapses. Undelivered sources stay
 * `streamed` pending; the browser fetches them once the document ends.
 */
async function streamRegions(
  session: RenderSession,
  root: StringRenderableNode,
  push: (part: string) => void,
): Promise<void> {
  const serialize = (node: StringRenderableNode) => node.toString(true, false);
  const tracker = new RegionTracker(root, serialize);
  const payload = session.payload();
  const state = payload.state === undefined ? undefined : streamedState(payload.state);
  const deltas = new SourceDeltas(state ?? { formatVersion: 1, sources: [] });
  const nonce = session.options.nonce;
  push(
    session.wrap(serialize(root)) +
    createPayloadScriptTag(session.rootId, state === undefined ? payload : { ...payload, state }) +
    streamBootstrap(nonce),
  );
  const started = performance.now();
  const budgetEnd = started + session.settleTimeout;
  let step: 'idle' | 'progress' | 'timeout';
  do {
    step = await session.nextSettlement(budgetEnd);
    const regions = tracker.changes();
    const sources = deltas.take(streamedState(session.dataRuntime.serializeState()));
    if (regions.length > 0 || sources.length > 0) {
      push(streamChunk(session.rootId, regions, sources, nonce));
    }
  } while (step === 'progress');
  session.settlement = Object.freeze({
    status: step === 'idle' ? 'complete' : 'timeout',
    settleMs: performance.now() - started,
  });
}

/**
 * Render a compiled application as a Web stream and expose its completion.
 *
 * In `stream` mode the shell is sent as soon as route preparation and mount
 * finish, followed by each pending region as `<template>` chunks in completion
 * order. In `resolve` mode the host can flush its document prefix while this
 * stream settles request data, then pipe a fully resolved application body
 * followed by its state envelope. In `shell` mode the pending UI is emitted
 * immediately and the browser fetches pending data itself.
 *
 * Cancelling the stream aborts the render session: in-flight route
 * preparation and data settlement stop and request runtimes are released.
 */
export function prepareRenderToReadableStream(
  component: ServerComponent,
  options: RenderOptions = {},
): PreparedRenderStream {
  const encoder = new TextEncoder();
  const prepared = Promise.withResolvers<void>();
  const queue: string[] = [];
  let wake: (() => void) | undefined;
  const push = (part: string): void => {
    queue.push(part);
    wake?.();
  };
  let session: RenderSession | undefined;
  const work = RenderSession.execute(
    component,
    options,
    stringTier(),
    async current => {
      session = current;
      await current.prepare();
      prepared.resolve();
      const root = current.mount() as unknown as StringRenderableNode;
      if (current.streamsRegions) return streamRegions(current, root, push);
      await current.settle();
      push(current.wrap(root.toString(current.markers, current.initialBindings)));
      if (current.carriesPayload && (options.markers === true || current.initialBindings)) {
        push(createPayloadScriptTag(current.rootId, current.payload()));
      }
    },
  );
  let finished = false;
  let failure: { readonly error: unknown } | undefined;
  void work.then(
    () => { finished = true; wake?.(); },
    (error: unknown) => { failure = { error }; finished = true; wake?.(); },
  );
  const ready = work.then(() => session!.settlement);
  // A failure before preparation completes rejects `prepared`; afterwards it
  // only rejects `ready` and the stream.
  work.catch(prepared.reject);
  // Consumers observe failures through the stream, `prepared`, or `ready`;
  // never leave the internal promises unhandled when none is awaited.
  ready.catch(() => {});
  prepared.promise.catch(() => {});

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (queue.length === 0 && !finished) {
        await new Promise<void>(resolve => { wake = resolve; });
        wake = undefined;
      }
      if (queue.length > 0) {
        for (const part of queue.splice(0)) controller.enqueue(encoder.encode(part));
        return;
      }
      if (failure !== undefined) controller.error(failure.error);
      else controller.close();
    },
    cancel(reason) {
      session?.abort(reason);
    },
  });
  return { stream, prepared: prepared.promise, ready };
}

export function renderToReadableStream(
  component: ServerComponent,
  options: RenderOptions = {},
): ReadableStream<Uint8Array> {
  return prepareRenderToReadableStream(component, options).stream;
}
