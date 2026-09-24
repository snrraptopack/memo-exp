import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { RequestError } from '../src';
import { createDataRuntime } from '../src/client';
import { disposeFetchResource } from '../src/resource';
import type {
  ActionResult,
  FetchResource,
  StandardSchemaV1,
} from '../src';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function settled<T>(resource: FetchResource<T>): Promise<void> {
  await vi.waitFor(() => {
    expect(resource.pending).toBe(false);
    expect(['success', 'error']).toContain(resource.status);
  });
}

async function actionSettled<T>(result: ActionResult<T>): Promise<void> {
  await vi.waitFor(() => {
    expect(['success', 'error']).toContain(result.state);
  });
}

describe('$fetch', () => {
  it('loads and decodes JSON into an honest resource state', async () => {
    const fetcher = vi.fn(async () => json([{ id: '1', name: 'Ada' }]));
    const client = createDataRuntime({ fetch: fetcher as typeof fetch });

    const users = client.$fetch<{ id: string; name: string }[]>('/api/users');
    expect(users.status).toBe('pending');
    expect(users.pending).toBe(true);

    await settled(users);
    expect(users.status).toBe('success');
    expect(users.data).toEqual([{ id: '1', name: 'Ada' }]);
    expect(users.error).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('shares a pending request and resolved data between active resources', async () => {
    let resolve!: (response: Response) => void;
    const response = new Promise<Response>(done => { resolve = done; });
    const fetcher = vi.fn(() => response);
    const client = createDataRuntime({ fetch: fetcher as typeof fetch });

    const first = client.$fetch<string[]>('/api/users');
    const second = client.$fetch<string[]>('/api/users');
    expect(fetcher).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    resolve(json(['Ada']));
    await settled(first);
    await settled(second);

    const third = client.$fetch<string[]>('/api/users');
    expect(third.data).toEqual(['Ada']);
    expect(third.pending).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);

    disposeFetchResource(first);
    disposeFetchResource(second);
    disposeFetchResource(third);

    const afterUnmount = client.$fetch<string[]>('/api/users');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    disposeFetchResource(afterUnmount);
  });

  it('normalizes query identity before sharing', async () => {
    const fetcher = vi.fn(async () => json(['Ada']));
    const client = createDataRuntime({ fetch: fetcher as typeof fetch });

    const first = client.$fetch<string[]>('/api/users', {
      query: { search: 'Ada', page: 1 },
    });
    const second = client.$fetch<string[]>('/api/users?page=1', {
      query: { search: 'Ada' },
    });
    await settled(first);
    await settled(second);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/users?page=1&search=Ada',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('sends method-aware JSON bodies through the colorless resource path', async () => {
    const calls: RequestInit[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {});
      return json({ votes: 43 });
    });
    const client = createDataRuntime({ fetch: fetcher as typeof fetch });
    const input = { id: 1 };

    const vote = client.$fetch<{ votes: number }>('/api/vote', {
      method: 'POST',
      body: input,
    });
    input.id = 2;

    await settled(vote);
    expect(vote.data).toEqual({ votes: 43 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toBe('{"id":1}');
    expect(new Headers(calls[0]?.headers).get('content-type'))
      .toBe('application/json');
  });

  it('does not cache non-GET requests unless caching is explicit', async () => {
    const fetcher = vi.fn(async () => json({ ok: true }));
    const client = createDataRuntime({ fetch: fetcher as typeof fetch });

    const first = client.$fetch('/api/vote', {
      method: 'POST',
      body: { id: 1 },
    });
    const second = client.$fetch('/api/vote', {
      method: 'POST',
      body: { id: 1 },
    });
    await settled(first);
    await settled(second);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('uses method and body in explicitly cached request identity', async () => {
    const fetcher = vi.fn(async () => json({ ok: true }));
    const client = createDataRuntime({ fetch: fetcher as typeof fetch });
    const cache = { scope: 'app' as const };

    const first = client.$fetch('/api/value', {
      method: 'POST',
      body: { id: 1 },
      cache,
    });
    const shared = client.$fetch('/api/value', {
      method: 'POST',
      body: { id: 1 },
      cache,
    });
    const otherBody = client.$fetch('/api/value', {
      method: 'POST',
      body: { id: 2 },
      cache,
    });
    const otherMethod = client.$fetch('/api/value', {
      method: 'PUT',
      body: { id: 1 },
      cache,
    });
    await Promise.all([
      settled(first),
      settled(shared),
      settled(otherBody),
      settled(otherMethod),
    ]);

    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('does not let an explicit key erase non-GET body identity', async () => {
    const fetcher = vi.fn(async () => json({ ok: true }));
    const client = createDataRuntime({ fetch: fetcher as typeof fetch });
    const options = {
      method: 'POST' as const,
      key: 'vote',
      cache: { scope: 'app' as const },
    };

    const first = client.$fetch('/api/vote', {
      ...options,
      body: { id: 1 },
    });
    const shared = client.$fetch('/api/vote', {
      ...options,
      body: { id: 1 },
    });
    const other = client.$fetch('/api/vote', {
      ...options,
      body: { id: 2 },
    });
    await Promise.all([settled(first), settled(shared), settled(other)]);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not transfer request bodies without an explicit public identity', async () => {
    const fetcher = vi.fn(async () => json({ ok: true }));
    const client = createDataRuntime({ fetch: fetcher as typeof fetch });
    const largeValue = 'x'.repeat(1024 * 1024);
    const request = client.$fetch('/api/upload', {
      method: 'POST',
      body: { largeValue },
    });

    await settled(request);
    expect(client.serializeState().sources).toHaveLength(0);
  });

  it('omits private or application-keyed requests from SSR transfer', async () => {
    const client = createDataRuntime({
      fetch: (async () => json({ ok: true })) as typeof fetch,
    });
    const requests = [
      client.$fetch('/api/search', { query: { token: 'private' } }),
      client.$fetch('/api/private', {
        headers: { authorization: 'Bearer private' },
      }),
      client.$fetch('/api/write', {
        method: 'POST',
        body: { value: 'private' },
      }),
      client.$fetch('/api/keyed', { key: 'session-specific' }),
    ];

    await Promise.all(requests.map(settled));
    expect(client.serializeState().sources).toHaveLength(0);
  });

  it('does not transfer values changed by JSON serialization', async () => {
    const schema: StandardSchemaV1<unknown, { created: Date }> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate() {
          return { value: { created: new Date('2026-01-01T00:00:00.000Z') } };
        },
      },
    };
    const client = createDataRuntime({
      fetch: (async () => json({ created: '2026-01-01' })) as typeof fetch,
    });
    const request = client.$fetch('/api/date', { validate: schema });
    await settled(request);

    expect(request.data?.created).toBeInstanceOf(Date);
    expect(client.serializeState().sources).toHaveLength(0);
  });

  it('rejects restored data when the schema contract changes', async () => {
    const serverSchema: StandardSchemaV1 = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate(value) {
          return { value };
        },
      },
    };
    const clientSchema: StandardSchemaV1 = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate(input) {
          return { value: input };
        },
      },
    };
    const server = createDataRuntime({
      fetch: (async () => json({ value: 'server' })) as typeof fetch,
    });
    const serverRequest = server.$fetch('/api/value', {
      validate: serverSchema,
    });
    await settled(serverRequest);

    const fetcher = vi.fn(async () => json({ value: 'client' }));
    const client = createDataRuntime({ fetch: fetcher as typeof fetch });
    client.restoreState(server.serializeState());
    const clientRequest = client.$fetch('/api/value', {
      validate: clientSchema,
    });
    await settled(clientRequest);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(clientRequest.data).toEqual({ value: 'client' });
  });

  it('does not cache HEAD or OPTIONS requests by default', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const client = createDataRuntime({ fetch: fetcher as typeof fetch });

    const requests = [
      client.$fetch('/api/status', { method: 'HEAD' }),
      client.$fetch('/api/status', { method: 'HEAD' }),
      client.$fetch('/api/status', { method: 'OPTIONS' }),
      client.$fetch('/api/status', { method: 'OPTIONS' }),
    ];
    await Promise.all(requests.map(settled));

    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('rejects bodies on GET and HEAD requests', () => {
    const client = createDataRuntime({
      fetch: (async () => json({ ok: true })) as typeof fetch,
    });

    expect(() => client.$fetch('/api/read', { body: { id: 1 } }))
      .toThrow('$fetch GET requests cannot include a body');
    expect(() => client.$fetch('/api/read', {
      method: 'HEAD',
      body: { id: 1 },
    })).toThrow('$fetch HEAD requests cannot include a body');
  });

  it('retains application cache after the last active resource is disposed', async () => {
    const fetcher = vi.fn(async () => json(['Ada']));
    const client = createDataRuntime({ fetch: fetcher as typeof fetch });
    const cache = { scope: 'app' as const };

    const first = client.$fetch<string[]>('/api/users', { cache });
    await settled(first);
    disposeFetchResource(first);

    const later = client.$fetch<string[]>('/api/users', { cache });
    expect(later.data).toEqual(['Ada']);
    expect(later.pending).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('infers and checks output from an optional Standard Schema validator', async () => {
    interface User { id: string; }
    const schema: StandardSchemaV1<unknown, User[]> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate(value) {
          return Array.isArray(value) && value.every(
            item => typeof item === 'object' && item !== null && 'id' in item,
          )
            ? { value: value as User[] }
            : { issues: [{ message: 'Expected users' }] };
        },
      },
    };
    const fetcher = vi.fn(async () => json([{ id: '1' }]));
    const client = createDataRuntime({ fetch: fetcher as typeof fetch });

    const users = client.$fetch('/external/users', { validate: schema });
    expectTypeOf(users.data).toEqualTypeOf<User[] | undefined>();
    await settled(users);
    expect(users.data).toEqual([{ id: '1' }]);
  });

  it('keeps invalid external data out of the resource', async () => {
    const schema: StandardSchemaV1<unknown, string[]> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => ({ issues: [{ message: 'Expected strings' }] }),
      },
    };
    const client = createDataRuntime({
      fetch: (async () => json([123])) as typeof fetch,
    });
    const users = client.$fetch('/external/users', { validate: schema });

    await settled(users);
    expect(users.status).toBe('error');
    expect(users.data).toBeUndefined();
    expect(users.error).toBeInstanceOf(RequestError);
    expect(users.error?.kind).toBe('validation');
  });
});

describe('$action', () => {
  interface Todo {
    id: string;
    title: string;
  }

  interface CreateTodo {
    title: string;
  }

  it('returns one live result and encodes plain input as JSON', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(init?.headers).toBeInstanceOf(Headers);
      expect((init?.headers as Headers).get('content-type')).toBe('application/json');
      expect(init?.body).toBe(JSON.stringify({ title: 'Write tests' }));
      return json({ id: '1', title: 'Write tests' });
    });
    const client = createDataRuntime({ fetch: fetcher as typeof fetch });
    const createTodo = client.$action<Todo, CreateTodo>('/api/todos');

    const creation = createTodo({ title: 'Write tests' });
    expect(creation.id).toBe('action-1');
    expect(creation.state).toBe('idle');

    await vi.waitFor(() => expect(creation.state).toBe('success'));
    expect(creation.data).toEqual({ id: '1', title: 'Write tests' });
  });

  it('keeps concurrent invocations independent', async () => {
    const responses: Array<(response: Response) => void> = [];
    const client = createDataRuntime({
      fetch: (() => new Promise<Response>(resolve => responses.push(resolve))) as typeof fetch,
    });
    const createTodo = client.$action<Todo, CreateTodo>('/api/todos');
    const first = createTodo({ title: 'First' });
    const second = createTodo({ title: 'Second' });

    expect(first.id).not.toBe(second.id);
    await vi.waitFor(() => expect(responses).toHaveLength(2));
    responses[1]!(json({ id: '2', title: 'Second' }));
    await actionSettled(second);
    expect(second.state).toBe('success');
    expect(first.state).toBe('pending');

    responses[0]!(json({ id: '1', title: 'First' }));
    await actionSettled(first);
    expect(first.data).toMatchObject({ id: '1' });
    expect(second.data).toMatchObject({ id: '2' });
  });

  it('stores a request failure on the returned result', async () => {
    const client = createDataRuntime({
      fetch: (async () => json({ message: 'No' }, 500)) as typeof fetch,
    });
    const createTodo = client.$action<Todo, CreateTodo>('/api/todos');
    const creation = createTodo({ title: 'Rejected' });

    await actionSettled(creation);
    expect(creation.state).toBe('error');
    expect(creation.error).toMatchObject({ kind: 'http', status: 500 });
  });
});
