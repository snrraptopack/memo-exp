import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDataRuntime } from '../src';
import {
  disposeFetchResource,
  subscribeFetchResource,
} from '../src/internal';
import type { FetchResource } from '../src';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function settled<T>(resource: FetchResource<T>): Promise<void> {
  await vi.waitFor(() => expect(resource.pending).toBe(false));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('data runtime lifecycle', () => {
  it('clears retained entries and resets attached resources to idle', async () => {
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    const runtime = createDataRuntime({ fetch: fetcher as typeof fetch });
    const resource = runtime.$fetch('/pending', { cache: { scope: 'app' } });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());

    runtime.clear();

    expect(resource.status).toBe('idle');
    expect(resource.pending).toBe(false);
    expect(resource.refreshing).toBe(false);
    expect(resource.error).toBeNull();
  });

  it('restarts an app-retained request after its last consumer aborts', async () => {
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      }));
    const runtime = createDataRuntime({ fetch: fetcher as typeof fetch });
    const cache = { scope: 'app' as const };
    const first = runtime.$fetch('/retained', { cache });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    disposeFetchResource(first);

    const second = runtime.$fetch('/retained', { cache });

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(second.status).toBe('pending');
    expect(second.pending).toBe(true);
    runtime.clear();
  });

  it('does not start a resource whose owner signal is already aborted', async () => {
    const fetcher = vi.fn(async () => json([]));
    const owner = new AbortController();
    owner.abort();
    const runtime = createDataRuntime({ fetch: fetcher as typeof fetch });

    const resource = runtime.$fetch('/never', { signal: owner.signal });
    await Promise.resolve();

    expect(fetcher).not.toHaveBeenCalled();
    expect(resource.status).toBe('idle');
    await expect(resource.refresh()).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('isolates listener failures from resource state transitions', async () => {
    const reportError = vi.fn();
    vi.stubGlobal('reportError', reportError);
    const runtime = createDataRuntime({
      fetch: (async () => json(['ready'])) as typeof fetch,
    });
    const resource = runtime.$fetch<string[]>('/read');
    subscribeFetchResource(resource, value => {
      if (value.status === 'success') throw new Error('resource listener');
    });
    await settled(resource);
    expect(resource.data).toEqual(['ready']);

    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it('rejects commands and subscriptions after generated-code disposal', async () => {
    const runtime = createDataRuntime({ fetch: (async () => json([])) as typeof fetch });
    const resource = runtime.$fetch<unknown[]>('/read');
    await settled(resource);
    disposeFetchResource(resource);

    await expect(resource.refresh()).rejects.toThrow('disposed fetch resource');
    expect(() => resource.abort()).toThrow('disposed fetch resource');
    expect(() => resource.update(() => [])).toThrow('disposed fetch resource');
    expect(() => resource.mutate(() => {})).toThrow('disposed fetch resource');
    expect(() => subscribeFetchResource(resource, () => {})).toThrow('disposed');
  });
});
