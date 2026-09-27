import type { CardDetail } from './cards';

export function wait(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(signal?.reason ?? new DOMException('Demo request canceled', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Ordinary Response objects with deterministic latency and one recoverable failure. */
export function createDemoFetch(): typeof fetch {
  const attempts = new Map<string, number>();
  const requestDemo = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(request?.url ?? String(input), 'http://demo.local');
    const match = /^\/demo\/cards\/(progressive|atomic)\/([^/]+)\/(fast|slow|retry)$/.exec(url.pathname);
    if (match === null) return Response.json({ message: 'Unknown demo endpoint' }, { status: 404 });
    const mode = match[1];
    const id = match[3];
    const attempt = (attempts.get(url.pathname) ?? 0) + 1;
    attempts.set(url.pathname, attempt);
    await wait(id === 'slow' ? 2800 : id === 'fast' ? 800 : 1500, init?.signal ?? request?.signal);
    if (mode === 'progressive' && id === 'retry' && attempt === 1) {
      return Response.json({ message: 'Intentional first-attempt failure. Retry this row.' }, { status: 503 });
    }
    const detail: CardDetail = {
      summary: mode === 'progressive' && id === 'retry'
        ? 'Recovered request is ready.'
        : `${id} request is ready.`,
    };
    return Response.json(detail);
  };
  return requestDemo as typeof fetch;
}
