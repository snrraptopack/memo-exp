import { describe, expect, it, vi } from 'vitest';
import { createDataRuntime } from '../src';
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

describe('resource concurrency', () => {
  it('keeps successful data visible when a refresh fails', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(['current']))
      .mockResolvedValueOnce(json({ message: 'failed' }, 503));
    const runtime = createDataRuntime({ fetch: fetcher as typeof fetch });
    const resource = runtime.$fetch<string[]>('/resource');
    await settled(resource);

    const refresh = resource.refresh();
    expect(resource).toMatchObject({
      data: ['current'],
      status: 'success',
      pending: true,
      refreshing: true,
    });
    await expect(refresh).rejects.toMatchObject({ kind: 'http', status: 503 });

    expect(resource).toMatchObject({
      data: ['current'],
      status: 'success',
      pending: false,
      refreshing: false,
    });
    expect(resource.error).toMatchObject({ kind: 'http', status: 503 });
  });

  it('detaches one consumer without cancelling a shared request', async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
    const runtime = createDataRuntime({ fetch: fetcher as typeof fetch });
    const first = runtime.$fetch<string[]>('/shared');
    const second = runtime.$fetch<string[]>('/shared');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());

    first.abort();
    finish(json(['done']));
    await settled(second);

    expect(first.status).toBe('idle');
    expect(first.data).toBeUndefined();
    expect(second.data).toEqual(['done']);
  });

  it('rejects an aborted consumer refresh while shared work continues', async () => {
    const finishes: Array<(response: Response) => void> = [];
    const fetcher = vi.fn(() => new Promise<Response>(resolve => finishes.push(resolve)));
    const runtime = createDataRuntime({ fetch: fetcher as typeof fetch });
    const owner = new AbortController();
    const first = runtime.$fetch<string[]>('/shared-refresh', {
      signal: owner.signal,
    });
    const second = runtime.$fetch<string[]>('/shared-refresh');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    finishes.shift()!(json(['initial']));
    await settled(first);
    await settled(second);

    const refresh = first.refresh();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const reason = new Error('consumer left');
    owner.abort(reason);

    await expect(refresh).rejects.toBe(reason);
    expect(first.error).toBeNull();
    finishes.shift()!(json(['updated']));
    await settled(second);
    expect(second.data).toEqual(['updated']);
  });

  it('does not share resources when caching is disabled', async () => {
    const fetcher = vi.fn(async () => json(['private']));
    const runtime = createDataRuntime({ fetch: fetcher as typeof fetch });
    const first = runtime.$fetch('/private', { cache: false });
    const second = runtime.$fetch('/private', { cache: false });
    await settled(first);
    await settled(second);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('action concurrency', () => {
  it('keeps visible state owned by the most recently started invocation', async () => {
    const finishes: Array<(response: Response) => void> = [];
    const fetcher = vi.fn(() => new Promise<Response>(resolve => finishes.push(resolve)));
    const runtime = createDataRuntime({ fetch: fetcher as typeof fetch });
    const action = runtime.$action<{ id: number }, number>('/save');

    const first = action(1);
    const second = action(2);
    await vi.waitFor(() => expect(finishes).toHaveLength(2));
    finishes[1]!(json({ id: 2 }));
    await expect(second).resolves.toEqual({ id: 2 });
    expect(action.data).toEqual({ id: 2 });
    expect(action.pending).toBe(true);

    finishes[0]!(json({ id: 1 }));
    await expect(first).resolves.toEqual({ id: 1 });
    expect(action.data).toEqual({ id: 2 });
    expect(action.status).toBe('success');
    expect(action.pending).toBe(false);
  });

  it('rolls back an optimistic change without fetching for a pre-aborted call', async () => {
    const fetcher = vi.fn(async (_input, init) =>
      init?.method === 'GET' ? json([]) : json({ id: 'saved' }));
    const runtime = createDataRuntime({ fetch: fetcher as typeof fetch });
    const items = runtime.$fetch<Array<{ id: string }>>('/items');
    await settled(items);
    const action = runtime.$action<{ id: string }>('/items');
    const owner = new AbortController();
    owner.abort();

    await expect(action(undefined, {
      signal: owner.signal,
      optimistic: items.append({ id: 'temporary' }),
    })).rejects.toMatchObject({ name: 'AbortError' });

    expect(items.data).toEqual([]);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
