import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WebHandler } from './index';

export interface NodeAdapterOptions {
  trustProxy?: boolean;
}

function requestOrigin(request: IncomingMessage, trustProxy: boolean): string {
  const forwarded = trustProxy ? request.headers['x-forwarded-proto'] : undefined;
  const protocol = Array.isArray(forwarded)
    ? forwarded[0]
    : forwarded?.split(',')[0]?.trim();
  const secure = 'encrypted' in request.socket && request.socket.encrypted === true;
  const scheme = protocol ?? (secure ? 'https' : 'http');
  const host = request.headers.host ?? 'localhost';
  return `${scheme}://${host}`;
}

function waitForDrainOrClose(target: ServerResponse): Promise<void> {
  if (target.destroyed || target.writableEnded) return Promise.resolve();
  return new Promise(resolve => {
    const finish = (): void => {
      target.off('drain', finish);
      target.off('close', finish);
      target.off('error', finish);
      resolve();
    };
    target.once('drain', finish);
    target.once('close', finish);
    target.once('error', finish);
  });
}

/** Convert a Node IncomingMessage into a Web Request with abort propagation. */
export function toWebRequest(
  request: IncomingMessage,
  options: NodeAdapterOptions = {},
): Request {
  const url = new URL(request.url ?? '/', requestOrigin(request, options.trustProxy === true));
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }

  const abort = new AbortController();
  request.once('aborted', () => abort.abort(new Error('Request aborted')));
  request.once('close', () => {
    if (!request.complete) abort.abort(new Error('Request closed'));
  });

  const method = request.method ?? 'GET';
  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers,
    signal: abort.signal,
  };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = Readable.toWeb(request) as unknown as ReadableStream<Uint8Array>;
    init.duplex = 'half';
  }
  return new Request(url, init);
}

/** Stream a Web Response into a Node ServerResponse with backpressure. */
export async function sendNodeResponse(
  response: Response,
  target: ServerResponse,
): Promise<void> {
  target.statusCode = response.status;
  target.statusMessage = response.statusText;

  for (const [name, value] of response.headers) {
    if (name === 'set-cookie') continue;
    target.setHeader(name, value);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) target.setHeader('set-cookie', cookies);

  if (response.body === null) {
    target.end();
    return;
  }

  const reader = response.body.getReader();
  const cancel = () => void reader.cancel(new Error('Client disconnected'));
  target.once('close', cancel);
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (!target.write(result.value)) {
        await waitForDrainOrClose(target);
        if (target.destroyed || target.writableEnded) return;
      }
    }
    target.end();
  } finally {
    target.off('close', cancel);
    reader.releaseLock();
  }
}

/** Adapt a Web handler to Node request/response callbacks. */
export function createNodeHandler(
  handler: WebHandler,
  options: NodeAdapterOptions = {},
) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const result = await handler(toWebRequest(request, options));
    await sendNodeResponse(result, response);
  };
}
