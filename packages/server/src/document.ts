import { readFileSync } from 'node:fs';

/** A page document split at the SSR outlet for streaming composition. */
export interface DocumentTemplate {
  /** Document head and body opening, up to and excluding the outlet. */
  readonly prefix: string;
  /** Document closing after the application host. */
  readonly suffix: string;
}

/** The single structural marker every page template must carry. */
export const SSR_OUTLET = '<!--ssr-outlet-->';

/**
 * Split a page template at its `<!--ssr-outlet-->` marker. The prefix streams
 * before the application render and the suffix closes the document after it.
 */
export function splitDocumentTemplate(
  template: string,
  source = 'document template',
): DocumentTemplate {
  const index = template.indexOf(SSR_OUTLET);
  if (index === -1) {
    throw new TypeError(`memo-dom: ${source} is missing the ${SSR_OUTLET} marker`);
  }
  if (template.indexOf(SSR_OUTLET, index + SSR_OUTLET.length) !== -1) {
    throw new TypeError(
      `memo-dom: ${source} contains more than one ${SSR_OUTLET} marker`,
    );
  }
  return {
    prefix: template.slice(0, index),
    suffix: template.slice(index + SSR_OUTLET.length),
  };
}

/**
 * Load and split a page template from the filesystem (Node convenience).
 * Edge hosts pass preloaded template content to `splitDocumentTemplate`
 * instead.
 */
export function loadDocumentTemplate(path: string | URL): DocumentTemplate {
  return splitDocumentTemplate(
    readFileSync(path, 'utf8'),
    `document '${String(path)}'`,
  );
}

/**
 * Compose the streamed document: prefix, application render body, suffix.
 *
 * Delivery is pull-driven: the prefix is available immediately and each
 * body chunk is read only when the consumer asks for more, so a slow client
 * applies backpressure to the render instead of buffering it. Cancelling the
 * composed stream cancels the application render.
 *
 * `onBodyError` handles a body failure after the response has committed.
 * When provided, its return value (if any) is written in place of the
 * application and the document still closes with its suffix; without it,
 * the composed stream errors.
 */
export function composeDocumentStream(parts: {
  prefix: string | Uint8Array;
  body: ReadableStream<Uint8Array>;
  suffix: string | Uint8Array;
  onBodyError?: (error: unknown) => string | Uint8Array | void;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const bytes = (value: string | Uint8Array): Uint8Array =>
    typeof value === 'string' ? encoder.encode(value) : value;
  const reader = parts.body.getReader();
  let finished = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes(parts.prefix));
    },
    async pull(controller) {
      try {
        const result = await reader.read();
        if (finished) return;
        if (!result.done) {
          controller.enqueue(result.value);
          return;
        }
      } catch (error) {
        if (finished) return;
        finished = true;
        reader.releaseLock();
        if (parts.onBodyError === undefined) {
          controller.error(error);
          return;
        }
        const recovery = parts.onBodyError(error);
        if (recovery !== undefined) controller.enqueue(bytes(recovery));
      }
      if (!finished) {
        finished = true;
        reader.releaseLock();
      }
      controller.enqueue(bytes(parts.suffix));
      controller.close();
    },
    async cancel(reason) {
      if (finished) return;
      finished = true;
      try {
        await reader.cancel(reason);
      } finally {
        reader.releaseLock();
      }
    },
  });
}
