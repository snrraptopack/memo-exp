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
  rebindResolvedValue,
  readResolvedValue,
  readResolvedValueForRender,
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
