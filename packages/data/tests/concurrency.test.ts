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
  it('does not let an older read overwrite a newer local replacement', async () => {
    let finish!: (response: Response) => void;
    let requestSignal!: AbortSignal;
    const runtime = createDataRuntime({
      fetch: ((_input, init) => {
        requestSignal = init?.signal as AbortSignal;
        return new Promise<Response>(resolve => { finish = resolve; });
      }) as typeof fetch,
    });
    const resource = runtime.$fetch<string[]>('/items');
    await vi.waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal));

    resource.update(() => ['local']);

    expect(requestSignal.aborted).toBe(true);
    expect(resource.data).toEqual(['local']);
    expect(resource.status).toBe('success');
    expect(resource.pending).toBe(false);

    // The injected fetcher deliberately ignores AbortSignal. Its stale answer
    // must still be rejected at the resource generation boundary.
    finish(json(['stale server value']));
    await Promise.resolve();
    await Promise.resolve();
    expect(resource.data).toEqual(['local']);
  });

  it('does not let an older read overwrite a newer direct mutation', async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(['server']))
      .mockImplementationOnce(() =>
        new Promise<Response>(resolve => { finish = resolve; }),
      );
    const runtime = createDataRuntime({
      fetch: fetcher as typeof fetch,
    });
    const resource = runtime.$fetch<string[]>('/items');
    await settled(resource);
    const refresh = resource.refresh();
    const refreshRejection = expect(refresh).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    resource.mutate(current => current?.push('local'));
    await refreshRejection;
    expect(resource.data).toEqual(['server', 'local']);
    expect(resource.pending).toBe(false);

    finish(json(['stale server value']));
    await Promise.resolve();
    await Promise.resolve();
    expect(resource.data).toEqual(['server', 'local']);
  });

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
  it('keeps state on the exact invocation that owns it', async () => {
    const finishes: Array<(response: Response) => void> = [];
    const fetcher = vi.fn(() => new Promise<Response>(resolve => finishes.push(resolve)));
    const runtime = createDataRuntime({ fetch: fetcher as typeof fetch });
    const action = runtime.$action<{ id: number }, number>('/save');

    const first = action(1);
    const second = action(2);
    await vi.waitFor(() => expect(finishes).toHaveLength(2));
    finishes[1]!(json({ id: 2 }));
    await vi.waitFor(() => expect(second.state).toBe('success'));
    expect(second.data).toEqual({ id: 2 });
    expect(first.state).toBe('pending');

    finishes[0]!(json({ id: 1 }));
    await vi.waitFor(() => expect(first.state).toBe('success'));
    expect(first.data).toEqual({ id: 1 });
    expect(second.data).toEqual({ id: 2 });
  });

  it('returns idle results before independently starting each request', async () => {
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    const runtime = createDataRuntime({ fetch: fetcher as typeof fetch });
    const action = runtime.$action<{ id: number }, number>('/save');
    const older = action(1);
    const newer = action(2);

    expect(older.state).toBe('idle');
    expect(newer.state).toBe('idle');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(older.state).toBe('pending');
    expect(newer.state).toBe('pending');
    runtime.clear();
    expect(older.state).toBe('idle');
    expect(newer.state).toBe('idle');
  });
});
