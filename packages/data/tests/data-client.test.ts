import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { RequestError } from '../src';
import { createDataRuntime } from '../src/client';
import { disposeFetchResource } from '../src/resource';
import type {
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
    expect(fetcher).toHaveBeenCalledTimes(0);

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

  it('encodes plain input as JSON and exposes live action state', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(init?.headers).toBeInstanceOf(Headers);
      expect((init?.headers as Headers).get('content-type')).toBe('application/json');
      expect(init?.body).toBe(JSON.stringify({ title: 'Write tests' }));
      return json({ id: '1', title: 'Write tests' });
    });
    const client = createDataRuntime({ fetch: fetcher as typeof fetch });
    const createTodo = client.$action<Todo, CreateTodo>('/api/todos');

    const operation = createTodo({ title: 'Write tests' });
    expect(createTodo.pending).toBe(true);
    const created = await operation;

    expect(created).toEqual({ id: '1', title: 'Write tests' });
    expect(createTodo.status).toBe('success');
    expect(createTodo.pending).toBe(false);
    expect(createTodo.data).toEqual(created);
  });

  it('commits an optimistic append from the returned item without refreshing', async () => {
    const existing: Todo = { id: '1', title: 'Existing' };
    const created: Todo = { id: '2', title: 'Created' };
    const temporary: Todo = { id: 'temporary', title: 'Created' };
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'GET' ? json([existing]) : json(created),
    );
    const client = createDataRuntime({ fetch: fetcher as typeof fetch });
    const todos = client.$fetch<Todo[]>('/api/todos');
    await settled(todos);
    const createTodo = client.$action<Todo, CreateTodo>('/api/todos');

    const operation = createTodo(
      { title: 'Created' },
      { optimistic: todos.append(temporary) },
    );
    expect(todos.data).toEqual([existing, temporary]);

    await expect(operation).resolves.toEqual(created);
    expect(todos.data).toEqual([existing, created]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rolls back only its own failed append and preserves later changes', async () => {
    const existing: Todo = { id: '1', title: 'Existing' };
    const temporary: Todo = { id: 'temporary', title: 'Temporary' };
    const concurrent: Todo = { id: '3', title: 'Concurrent' };
    let resolveAction!: (response: Response) => void;
    const actionResponse = new Promise<Response>(done => {
      resolveAction = done;
    });
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'GET'
        ? Promise.resolve(json([existing]))
        : actionResponse,
    );
    const client = createDataRuntime({ fetch: fetcher as typeof fetch });
    const todos = client.$fetch<Todo[]>('/api/todos');
    await settled(todos);
    const createTodo = client.$action<Todo, CreateTodo>('/api/todos');

    const operation = createTodo(
      { title: temporary.title },
      { optimistic: todos.append(temporary) },
    );
    todos.mutate(items => items?.push(concurrent));
    resolveAction(json({ message: 'No' }, 500));

    await expect(operation).rejects.toMatchObject({ kind: 'http', status: 500 });
    expect(todos.data).toEqual([existing, concurrent]);
  });

  it('replaces an optimistic update with the authoritative action result', async () => {
    const existing: Todo = { id: '1', title: 'Old title' };
    const temporary: Todo = { id: '1', title: 'Saving title' };
    const saved: Todo = { id: '1', title: 'Server title' };
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'GET' ? json([existing]) : json(saved),
    );
    const client = createDataRuntime({ fetch: fetcher as typeof fetch });
    const todos = client.$fetch<Todo[]>('/api/todos');
    await settled(todos);
    const updateTodo = client.$action<Todo, CreateTodo>('/api/todos/1', {
      method: 'PATCH',
    });

    const operation = updateTodo(
      { title: temporary.title },
      { optimistic: todos.replace(todos.data![0]!, temporary) },
    );
    expect(todos.data).toEqual([temporary]);
    await operation;
    expect(todos.data).toEqual([saved]);
  });

  it('restores an optimistically removed item at its original position', async () => {
    const first: Todo = { id: '1', title: 'First' };
    const removed: Todo = { id: '2', title: 'Removed' };
    const last: Todo = { id: '3', title: 'Last' };
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'GET'
        ? json([first, removed, last])
        : json({ message: 'No' }, 500),
    );
    const client = createDataRuntime({ fetch: fetcher as typeof fetch });
    const todos = client.$fetch<Todo[]>('/api/todos');
    await settled(todos);
    const deleteTodo = client.$action<void, string>('/api/todos/2', {
      method: 'DELETE',
    });
    const loadedRemoved = todos.data![1]!;

    const operation = deleteTodo(loadedRemoved.id, {
      optimistic: todos.remove<void>(loadedRemoved),
    });
    expect(todos.data?.map(todo => todo.id)).toEqual(['1', '3']);

    await expect(operation).rejects.toMatchObject({ status: 500 });
    expect(todos.data?.map(todo => todo.id)).toEqual(['1', '2', '3']);
  });
});
