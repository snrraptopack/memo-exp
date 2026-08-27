export type WebHandler = (
  request: Request,
) => Response | Promise<Response>;

export interface DocumentStreamParts {
  readonly prefix: string | Uint8Array;
  readonly body: ReadableStream<Uint8Array>;
  readonly suffix: string | Uint8Array;
}

function bytes(value: string | Uint8Array, encoder: TextEncoder): Uint8Array {
  return typeof value === 'string' ? encoder.encode(value) : value;
}

/**
 * Concatenate a document prefix, an application byte stream, and a suffix
 * without buffering the application body. Cancellation propagates to the
 * source reader.
 */
export function createDocumentStream(
  parts: DocumentStreamParts,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(bytes(parts.prefix, encoder));
      reader = parts.body.getReader();
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          controller.enqueue(result.value);
        }
        controller.enqueue(bytes(parts.suffix, encoder));
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
    async cancel(reason) {
      await reader?.cancel(reason);
    },
  });
}

export function htmlResponse(
  body: BodyInit | null,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'text/html; charset=utf-8');
  }
  return new Response(body, { ...init, headers });
}
