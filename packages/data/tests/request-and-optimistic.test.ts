import { describe, expect, it, vi } from 'vitest';
import { createDataRuntime, RequestError } from '../src';
import { disposeFetchResource } from '../src/internal';
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

describe('request identity and errors', () => {
  it('classifies a malformed non-success body as an HTTP failure', async () => {
    const runtime = createDataRuntime({
      fetch: (async () => new Response('{broken', {
        status: 500,
        statusText: 'Server Error',
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch,
    });
    const resource = runtime.$fetch('/broken');

    await settled(resource);

    expect(resource.error).toBeInstanceOf(RequestError);
    expect(resource.error).toMatchObject({
      kind: 'http',
      status: 500,
      statusText: 'Server Error',
    });
  });

  it('does not wrap an abort during response decoding', async () => {
    const response = {
      status: 200,
      statusText: 'OK',
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.reject(new DOMException('Aborted', 'AbortError')),
      text: () => Promise.resolve(''),
    } as unknown as Response;
    const runtime = createDataRuntime({ fetch: (async () => response) as typeof fetch });
    const resource = runtime.$fetch('/aborted');

    await vi.waitFor(() => expect(resource.pending).toBe(false));

    expect(resource.status).toBe('idle');
    expect(resource.error).toBeNull();
  });

  it('strips fragments and shares equivalent absolute request identities', async () => {
    const fetcher = vi.fn(async () => json(['shared']));
    const runtime = createDataRuntime({
      fetch: fetcher as typeof fetch,
      baseURL: 'https://example.test/app/',
    });

    const first = runtime.$fetch<string[]>('/api/users#first');
    const second = runtime.$fetch<string[]>('https://example.test/api/users#second');
    await settled(first);
    await settled(second);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.test/api/users',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('snapshots headers before request identity and execution', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer first');
      return json({ ok: true });
    });
    const headers = new Headers({ authorization: 'Bearer first' });
    const runtime = createDataRuntime({ fetch: fetcher as typeof fetch });
    const resource = runtime.$fetch('/profile', { headers });
    headers.set('authorization', 'Bearer changed');

    await settled(resource);

    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe('optimistic collection safety', () => {
  interface Item { id: string; }

  it('does not insert an item when removing an absent reference rolls back', async () => {
    const existing: Item = { id: 'existing' };
    const absent: Item = { id: 'absent' };
    const runtime = createDataRuntime({
      fetch: (async (_input, init) =>
        init?.method === 'GET' ? json([existing]) : json({ error: true }, 500)) as typeof fetch,
    });
    const items = runtime.$fetch<Item[]>('/items');
    await settled(items);
    const remove = runtime.$action<void>('/items', { method: 'DELETE' });

    await expect(remove(undefined, {
      optimistic: items.remove<void>(absent),
    })).rejects.toMatchObject({ kind: 'http' });

    expect(items.data).toEqual([existing]);
  });

  it('removes and restores only one duplicate occurrence', async () => {
    const duplicate: Item = { id: 'same-reference' };
    const runtime = createDataRuntime({
      fetch: (async (_input, init) =>
        init?.method === 'GET'
          ? json([duplicate, duplicate])
          : json({ error: true }, 500)) as typeof fetch,
    });
    const items = runtime.$fetch<Item[]>('/items');
    await settled(items);
    const loaded = items.data![0]!;
    const remove = runtime.$action<void>('/items', { method: 'DELETE' });
    const operation = remove(undefined, {
      optimistic: items.remove<void>(loaded),
    });
    expect(items.data).toHaveLength(1);

    await expect(operation).rejects.toMatchObject({ kind: 'http' });
    expect(items.data).toHaveLength(2);
  });

  it('rejects reuse of an already consumed optimistic change', async () => {
    const temporary: Item = { id: 'temporary' };
    const runtime = createDataRuntime({
      fetch: (async (_input, init) =>
        init?.method === 'GET' ? json([]) : json({ id: 'saved' })) as typeof fetch,
    });
    const items = runtime.$fetch<Item[]>('/items');
    await settled(items);
    const create = runtime.$action<Item>('/items');
    const change = items.append(temporary);

    await create(undefined, { optimistic: change });
    await expect(create(undefined, { optimistic: change })).rejects.toThrow(
      'Invalid optimistic change',
    );
    expect(items.data).toEqual([{ id: 'saved' }]);
    disposeFetchResource(items);
  });
});
