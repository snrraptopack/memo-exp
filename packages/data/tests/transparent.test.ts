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
});
