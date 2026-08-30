import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDataRuntime } from '../src';
import {
  disposeActionResult,
  disposeFetchResource,
  subscribeActionResult,
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

  it('makes runtime clearing a logical boundary for a non-cooperative action fetcher', async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
    const runtime = createDataRuntime({ fetch: fetcher as typeof fetch });
    const action = runtime.$action<{ saved: boolean }>('/save');
    const result = action();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());

    runtime.clear();
    finish(json({ saved: true }));

    await Promise.resolve();
    await Promise.resolve();
    expect(result.state).toBe('idle');
  });

  it('resets active actions when their runtime is cleared', async () => {
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    const runtime = createDataRuntime({ fetch: fetcher as typeof fetch });
    const action = runtime.$action('/save');
    const result = action();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());

    runtime.clear();

    expect(result.state).toBe('idle');
  });

  it('isolates listener failures from resource and action state transitions', async () => {
    const reportError = vi.fn();
    vi.stubGlobal('reportError', reportError);
    const runtime = createDataRuntime({
      fetch: (async (_input, init) =>
        init?.method === 'GET' ? json(['ready']) : json({ saved: true })) as typeof fetch,
    });
    const resource = runtime.$fetch<string[]>('/read');
    subscribeFetchResource(resource, value => {
      if (value.status === 'success') throw new Error('resource listener');
    });
    await settled(resource);
    expect(resource.data).toEqual(['ready']);

    const action = runtime.$action<{ saved: boolean }>('/save');
    const result = action();
    subscribeActionResult(result, value => {
      if (value.state === 'pending') throw new Error('action listener');
    });
    await vi.waitFor(() => expect(result.state).toBe('success'));
    expect(result.data).toEqual({ saved: true });
    expect(reportError).toHaveBeenCalledTimes(2);
  });

  it('removes a listener when its initial subscription throws', () => {
    const reportError = vi.fn();
    vi.stubGlobal('reportError', reportError);
    const runtime = createDataRuntime({ fetch: (() => new Promise(() => {})) as typeof fetch });
    const action = runtime.$action('/save');
    const result = action();

    expect(() => subscribeActionResult(result, () => {
      throw new Error('initial listener');
    })).toThrow('initial listener');
    runtime.clear();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('rejects commands and subscriptions after generated-code disposal', async () => {
    const runtime = createDataRuntime({ fetch: (async () => json([])) as typeof fetch });
    const resource = runtime.$fetch<unknown[]>('/read');
    await settled(resource);
    const action = runtime.$action('/save');
    const result = action();
    disposeFetchResource(resource);
    disposeActionResult(result);

    await expect(resource.refresh()).rejects.toThrow('disposed fetch resource');
    expect(() => resource.abort()).toThrow('disposed fetch resource');
    expect(() => resource.update(() => [])).toThrow('disposed fetch resource');
    expect(() => resource.mutate(() => {})).toThrow('disposed fetch resource');
    expect(() => subscribeFetchResource(resource, () => {})).toThrow('disposed');
    expect(() => subscribeActionResult(result, () => {})).toThrow('disposed');
  });
});
