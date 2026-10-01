import { StringDocument, type StringRenderableNode } from './string-document';
import { createPayloadScriptTag } from './index';
import type { RenderOptions } from './index';
import type { ServerComponent } from './root-id';
import { RenderSession, type RenderSettlement } from './session';

export interface PreparedRenderStream {
  readonly stream: ReadableStream<Uint8Array>;
  /** Settles after the complete server render succeeds or rejects. */
  readonly ready: Promise<RenderSettlement>;
}

/**
 * Render a compiled application as a Web stream and expose its completion.
 *
 * This is ordered, settled streaming—not suspense/out-of-order region
 * streaming. In `resolve` mode the host can flush its document prefix while
 * this stream settles request data, then pipe a fully resolved application
 * body followed by its state envelope. In `shell` mode the pending UI is
 * emitted immediately and no late replacement protocol is implied.
 *
 * Cancelling the stream aborts the render session: in-flight route
 * preparation and data settlement stop and request runtimes are released.
 */
export function prepareRenderToReadableStream(
  component: ServerComponent,
  options: RenderOptions = {},
): PreparedRenderStream {
  const encoder = new TextEncoder();
  let session: RenderSession | undefined;
  const parts = RenderSession.execute(
    component,
    options,
    { mode: 'server-string', document: new StringDocument() },
    async current => {
      session = current;
      await current.prepare();
      const root = current.mount() as unknown as StringRenderableNode;
      await current.settle();
      const html = current.wrap(root.toString(options.markers === true));
      return options.markers === true
        ? [html, createPayloadScriptTag(current.rootId, current.payload())]
        : [html];
    },
  );
  const ready = parts.then(() => session!.settlement);
  // Consumers observe failures through the stream or `ready`; never leave
  // the internal render promise unhandled when neither is awaited.
  ready.catch(() => {});

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (const part of await parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
    cancel(reason) {
      session?.abort(reason);
    },
  });
  return { stream, ready };
}

export function renderToReadableStream(
  component: ServerComponent,
  options: RenderOptions = {},
): ReadableStream<Uint8Array> {
  return prepareRenderToReadableStream(component, options).stream;
}
