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
 * Cancelling the composed stream cancels the application render.
 */
export function composeDocumentStream(parts: {
  prefix: string | Uint8Array;
  body: ReadableStream<Uint8Array>;
  suffix: string | Uint8Array;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const bytes = (value: string | Uint8Array): Uint8Array =>
    typeof value === 'string' ? encoder.encode(value) : value;
  const reader = parts.body.getReader();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(bytes(parts.prefix));
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          controller.enqueue(result.value);
        }
        controller.enqueue(bytes(parts.suffix));
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}
