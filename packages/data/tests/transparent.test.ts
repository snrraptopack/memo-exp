import { describe, expect, it, vi } from 'vitest';
import {
  $track,
  createDataRuntime,
  RequestError,
  UnresolvedDataReadError,
  type ResolvedValue,
} from '../src';
import {
  connectResolvedValue,
  createEventSourceSlot,
  disposeEventSourceSlot,
  rebindEventSourceSlot,
  rebindResolvedValue,
  rebindResolvedValueFromFactory,
  readResolvedValue,
  readResolvedValueForRender,
  retryResolvedValues,
} from '../src/internal';

interface User {
  id: number;
  name: string;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('transparent resolved values', () => {
  it('retries all failed values represented by a shared boundary', async () => {
    const requests: Array<{
      url: string;
      resolve(response: Response): void;
    }> = [];
    const runtime = createDataRuntime({
      fetch: ((input: string | URL | Request) =>
        new Promise<Response>(resolve => {
          requests.push({ url: String(input), resolve });
        })) as typeof fetch,
    });
    const leftResource = runtime.$fetch<User>('/left');
    const rightResource = runtime.$fetch<User>('/right');
    const left = leftResource as unknown as ResolvedValue<User>;
    const right = rightResource as unknown as ResolvedValue<User>;

    await vi.waitFor(() => expect(requests).toHaveLength(2));
    requests[0]!.resolve(json({ message: 'left failed' }, 501));
    requests[1]!.resolve(json({ message: 'right failed' }, 502));
    await vi.waitFor(() => {
      expect($track(left).error?.status).toBe(501);
      expect($track(right).error?.status).toBe(502);
    });

    const retry = retryResolvedValues([left, right]);
    await vi.waitFor(() => expect(requests).toHaveLength(4));
    expect(requests[2]!.url).toBe('/left');
    expect(requests[3]!.url).toBe('/right');
    requests[2]!.resolve(json({ id: 1, name: 'Left' }));
    requests[3]!.resolve(json({ id: 2, name: 'Right' }));

    await expect(retry).resolves.toEqual([
      { id: 1, name: 'Left' },
      { id: 2, name: 'Right' },
    ]);
    runtime.clear();
  });

  it('tracks non-GET fetches through the same colorless state channel', async () => {
    let finish!: (response: Response) => void;
    let requestInit: RequestInit | undefined;
    const runtime = createDataRuntime({
      fetch: ((_input, init) => {
        requestInit = init;
        return new Promise<Response>(resolve => {
          finish = resolve;
        });
      }) as typeof fetch,
    });
    const resource = runtime.$fetch<User>('/users/1', {
      method: 'PATCH',
      body: { name: 'Grace' },
    });
    const user = resource as unknown as ResolvedValue<User>;
    const state = $track(user);

    expect(state.pending).toBe(true);
    expect(requestInit?.method).toBe('PATCH');
    expect(requestInit?.body).toBe('{"name":"Grace"}');

    finish(json({ id: 1, name: 'Grace' }));
    await vi.waitFor(() => expect(state.status).toBe('success'));

    expect(readResolvedValue(user)).toEqual({ id: 1, name: 'Grace' });
    expect(state.pending).toBe(false);
    expect(state.error).toBeNull();
    runtime.clear();
  });

  it('separates transparent value reads from tracked request state', async () => {
    let resolve!: (response: Response) => void;
    const runtime = createDataRuntime({
      fetch: (() => new Promise<Response>(accept => {
        resolve = accept;
      })) as typeof fetch,
    });
    const resource = runtime.$fetch<User>('/user');
    const user = resource as unknown as ResolvedValue<User>;
    const state = $track(user);

    expect(state.pending).toBe(true);
    expect(readResolvedValueForRender(user)).toBeUndefined();
    expect(() => readResolvedValue(user, 'user', 'Profile:1:1'))
      .toThrow(UnresolvedDataReadError);

    let transitions = 0;
    const disconnect = connectResolvedValue(user, () => transitions++);
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    resolve(json({ id: 1, name: 'Ada' }));
    await resource.refresh();

    expect(readResolvedValue(user)).toEqual({ id: 1, name: 'Ada' });
    expect(state.status).toBe('success');
    expect(state.pending).toBe(false);
    expect(transitions).toBe(1);

    resource.update(current => ({ ...current!, name: 'Grace' }));
    expect(readResolvedValue(user).name).toBe('Grace');
    expect(transitions).toBe(2);

    disconnect();
    runtime.clear();
  });

  it('keeps initial request failures loud at render and imperative sites', async () => {
    const runtime = createDataRuntime({
      fetch: (async () => json({ message: 'offline' }, 503)) as typeof fetch,
    });
    const resource = runtime.$fetch<User>('/user');
    const user = resource as unknown as ResolvedValue<User>;

    await expect(resource.refresh()).rejects.toBeInstanceOf(RequestError);
    expect(() => readResolvedValueForRender(user)).toThrow(RequestError);
    expect(() => readResolvedValue(user)).toThrow(RequestError);
    runtime.clear();
  });

  it('correlates concurrent request outcomes with unique execution IDs', async () => {
    const requests: Array<(response: Response) => void> = [];
    const runtime = createDataRuntime({
      fetch: (() => new Promise<Response>(resolve => {
        requests.push(resolve);
      })) as typeof fetch,
    });
    const first = runtime.$fetch<User>('/vote', {
      method: 'POST',
      body: { id: 1 },
    }) as unknown as ResolvedValue<User>;
    const second = runtime.$fetch<User>('/vote', {
      method: 'POST',
      body: { id: 1 },
    }) as unknown as ResolvedValue<User>;
    const firstTrack = $track(first);
    const secondTrack = $track(second);
    const firstSuccess = vi.fn();
    const firstError = vi.fn();
    const secondSuccess = vi.fn();
    const secondError = vi.fn();

    expect(firstTrack.id).not.toBe(secondTrack.id);
    const firstId = firstTrack.id;
    const secondId = secondTrack.id;
    firstTrack.onSuccess(firstSuccess);
    firstTrack.onError(firstError);
    secondTrack.onSuccess(secondSuccess);
    secondTrack.onError(secondError);

    await vi.waitFor(() => expect(requests).toHaveLength(2));
    requests[1]!(json({ id: 1, name: 'second' }));
    requests[0]!(json({ message: 'first failed' }, 503));

    await vi.waitFor(() => {
      expect(secondSuccess).toHaveBeenCalledWith(
        { id: 1, name: 'second' },
        secondId,
      );
      expect(firstError).toHaveBeenCalledWith(
        expect.any(RequestError),
        firstId,
      );
    });
    expect(firstSuccess).not.toHaveBeenCalled();
    expect(secondError).not.toHaveBeenCalled();

    const lateSuccess = vi.fn();
    secondTrack.onSuccess(lateSuccess);
    expect(lateSuccess).toHaveBeenCalledTimes(1);

    const settledId = secondTrack.id;
    const refreshed = secondTrack.refresh();
    expect(secondTrack.id).not.toBe(settledId);
    await vi.waitFor(() => expect(requests).toHaveLength(3));
    requests[2]!(json({ id: 1, name: 'refreshed' }));
    await expect(refreshed).resolves.toEqual({ id: 1, name: 'refreshed' });
    runtime.clear();
  });

  it('does not abort dispatched event requests when the visible slot is replaced', async () => {
    const requests: Array<{
      signal: AbortSignal;
      resolve: (response: Response) => void;
    }> = [];
    const runtime = createDataRuntime({
      fetch: ((_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>(resolve => {
          requests.push({ signal: init!.signal!, resolve });
        })) as typeof fetch,
    });
    const first = runtime.$fetch<User>('/vote', {
      method: 'POST',
      body: { id: 1 },
    }) as unknown as ResolvedValue<User>;
    const second = runtime.$fetch<User>('/vote', {
      method: 'POST',
      body: { id: 1 },
    }) as unknown as ResolvedValue<User>;
    const firstSuccess = vi.fn();
    const secondSuccess = vi.fn();
    $track(first).onSuccess(firstSuccess);
    $track(second).onSuccess(secondSuccess);
    const slot = createEventSourceSlot();
    let visible: ResolvedValue<User> | null = first;
    rebindEventSourceSlot(slot, () => visible, () => {});

    visible = second;
    rebindEventSourceSlot(slot, () => visible, () => {});
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0]!.signal.aborted).toBe(false);

    requests[1]!.resolve(json({ id: 1, name: 'second' }));
    requests[0]!.resolve(json({ id: 1, name: 'first' }));
    await vi.waitFor(() => {
      expect(firstSuccess).toHaveBeenCalledOnce();
      expect(secondSuccess).toHaveBeenCalledOnce();
    });
    expect(requests[0]!.signal.aborted).toBe(false);
    expect(requests[1]!.signal.aborted).toBe(false);

    disposeEventSourceSlot(slot);
    runtime.clear();
  });

  it('rebinds a stable transparent value when its query identity changes', async () => {
    const requests: Array<{
      url: string;
      signal: AbortSignal;
      resolve: (response: Response) => void;
    }> = [];
    const runtime = createDataRuntime({
      fetch: ((input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>(resolve => {
          requests.push({
            url: String(input),
            signal: init!.signal!,
            resolve,
          });
        })) as typeof fetch,
    });
    const resource = runtime.$fetch<User[]>('/users', {
      query: { search: 'Ada' },
    });
    const users = resource as unknown as ResolvedValue<User[]>;
    let transitions = 0;
    const disconnect = connectResolvedValue(users, () => transitions++);

    await vi.waitFor(() => expect(requests).toHaveLength(1));
    rebindResolvedValue(users, '/users', { query: { search: 'Grace' } });
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    expect(requests[0]!.url).toBe('/users?search=Ada');
    expect(requests[0]!.signal.aborted).toBe(true);
    expect(requests[1]!.url).toBe('/users?search=Grace');

    requests[1]!.resolve(json([{ id: 2, name: 'Grace' }]));
    await vi.waitFor(() => {
      expect(readResolvedValueForRender(users)).toEqual([
        { id: 2, name: 'Grace' },
      ]);
    });

    // Replaying an equal normalized query preserves the active entry.
    rebindResolvedValue(users, '/users', { query: { search: 'Grace' } });
    await Promise.resolve();
    expect(requests).toHaveLength(2);
    expect(transitions).toBeGreaterThan(0);

    // A non-cooperative obsolete fetch cannot overwrite the current query.
    requests[0]!.resolve(json([{ id: 1, name: 'Ada' }]));
    await Promise.resolve();
    await Promise.resolve();
    expect(readResolvedValue(users)).toEqual([{ id: 2, name: 'Grace' }]);

    disconnect();
    runtime.clear();
  });

  it('rebinds through an imported factory without treating its arguments as URLs', async () => {
    const requests: Array<{
      url: string;
      signal: AbortSignal;
      resolve: (response: Response) => void;
    }> = [];
    const runtime = createDataRuntime({
      fetch: ((input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>(resolve => {
          requests.push({
            url: String(input),
            signal: init!.signal!,
            resolve,
          });
        })) as typeof fetch,
    });
    const getStory = (id: number): ResolvedValue<User> =>
      runtime.$fetch<User>('/_fn/stories/getStory', {
        query: { id },
      }) as unknown as ResolvedValue<User>;
    const story = getStory(1);

    await vi.waitFor(() => expect(requests).toHaveLength(1));
    rebindResolvedValueFromFactory(story, () => getStory(2));
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    expect(requests[0]!.url).toBe('/_fn/stories/getStory?id=1');
    expect(requests[0]!.signal.aborted).toBe(true);
    expect(requests[1]!.url).toBe('/_fn/stories/getStory?id=2');

    requests[1]!.resolve(json({ id: 2, name: 'Grace' }));
    await vi.waitFor(() => {
      expect(readResolvedValueForRender(story)).toEqual({
        id: 2,
        name: 'Grace',
      });
    });

    rebindResolvedValueFromFactory(story, () => getStory(2));
    await Promise.resolve();
    expect(requests).toHaveLength(2);
    runtime.clear();
  });

  it('rebinds method and body as reactive request inputs', async () => {
    const requests: Array<{
      method: string | undefined;
      body: BodyInit | null | undefined;
      signal: AbortSignal;
      resolve: (response: Response) => void;
    }> = [];
    const runtime = createDataRuntime({
      fetch: ((_input, init) => new Promise<Response>(resolve => {
        requests.push({
          method: init?.method,
          body: init?.body,
          signal: init?.signal as AbortSignal,
          resolve,
        });
      })) as typeof fetch,
    });
    const resource = runtime.$fetch<User>('/users/1', {
      method: 'PATCH',
      body: { name: 'Ada' },
    });
    const user = resource as unknown as ResolvedValue<User>;

    await vi.waitFor(() => expect(requests).toHaveLength(1));
    rebindResolvedValue(user, '/users/1', {
      method: 'PUT',
      body: { name: 'Grace' },
    });
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    expect(requests[0]).toMatchObject({ method: 'PATCH', body: '{"name":"Ada"}' });
    expect(requests[0]?.signal.aborted).toBe(true);
    expect(requests[1]).toMatchObject({ method: 'PUT', body: '{"name":"Grace"}' });

    requests[1]!.resolve(json({ id: 1, name: 'Grace' }));
    await vi.waitFor(() => {
      expect(readResolvedValueForRender(user)).toEqual({ id: 1, name: 'Grace' });
    });

    rebindResolvedValue(user, '/users/1', {
      method: 'PUT',
      body: { name: 'Grace' },
    });
    await Promise.resolve();
    expect(requests).toHaveLength(2);

    requests[0]!.resolve(json({ id: 1, name: 'Ada' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(readResolvedValue(user)).toEqual({ id: 1, name: 'Grace' });
    runtime.clear();
  });

  it('claims SSR state for the initial query and fetches after a rebind', async () => {
    const server = createDataRuntime({
      fetch: (async () => json([{ id: 1, name: 'Ada' }])) as typeof fetch,
    });
    server.$fetch<User[]>('/users', { query: { search: 'Ada' } });
    expect(await server.settle()).toBe(true);
    const state = server.serializeState();

    const requests: string[] = [];
    const client = createDataRuntime({
      fetch: (async (input: string | URL | Request) => {
        requests.push(String(input));
        return json([{ id: 2, name: 'Grace' }]);
      }) as typeof fetch,
    });
    client.restoreState(state);
    const resource = client.$fetch<User[]>('/users', {
      query: { search: 'Ada' },
    });
    const users = resource as unknown as ResolvedValue<User[]>;

    expect(readResolvedValue(users)).toEqual([{ id: 1, name: 'Ada' }]);
    expect(requests).toHaveLength(0);

    rebindResolvedValue(users, '/users', { query: { search: 'Grace' } });
    await vi.waitFor(() => expect(requests).toEqual(['/users?search=Grace']));
    await vi.waitFor(() => {
      expect(readResolvedValueForRender(users)).toEqual([
        { id: 2, name: 'Grace' },
      ]);
    });

    server.clear();
    client.clear();
  });
});
