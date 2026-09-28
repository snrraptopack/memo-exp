import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  $fetch,
  $forms,
  clearDataRuntime,
  createDataRuntime,
  RequestError,
  type FetchResource,
  type ResolvedValue,
  type StandardSchemaV1,
} from '@memoized-dom/data';
import { optimistic } from '../src';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

afterEach(() => clearDataRuntime());

describe('optimistic', () => {
  it('preserves transparent source and form payload types', () => {
    const schema: StandardSchemaV1<unknown, { id: string }> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => ({ value: { id: 'a' } }),
      },
    };
    const submit = optimistic({
      action: (fields: { id: string }) => $fetch<{ savedId: string }>(`/vote/${fields.id}`, { method: 'POST' }),
      apply: () => () => {},
      reconcile(saved) { expectTypeOf(saved.savedId).toEqualTypeOf<string>(); },
    });
    expectTypeOf(submit).returns.toEqualTypeOf<ResolvedValue<{ savedId: string }>>();
    const form = $forms({ schema, action: submit });
    expectTypeOf(form.result).toEqualTypeOf<{ savedId: string } | undefined>();
  });

  it('replaces each temporary row with its own returned data, without refetching', async () => {
    const work = new Map('abcd'.split('').map(letter => [letter, deferred<{ id: string; text: string }>()]));
    const rows: Array<{ id: string; text: string; pending: boolean }> = [];
    const submit = optimistic({
      action: (text: string) => work.get(text)!.promise,
      apply(text, id) {
        rows.push({ id, text, pending: true });
        return () => {
          const index = rows.findIndex(row => row.id === id);
          if (index !== -1) rows.splice(index, 1);
        };
      },
      reconcile(saved, _text, id) {
        const index = rows.findIndex(row => row.id === id);
        if (index !== -1) rows.splice(index, 1, { ...saved, pending: false });
      },
    });

    for (const letter of 'abcd') submit(letter);
    expect(rows.map(row => row.text)).toEqual(['a', 'b', 'c', 'd']);
    work.get('c')!.resolve({ id: 'server-c', text: 'C' });
    await vi.waitFor(() => expect(rows[2]).toEqual({ id: 'server-c', text: 'C', pending: false }));
    work.get('a')!.reject(new Error('a failed'));
    await vi.waitFor(() => expect(rows).toHaveLength(3));
    work.get('d')!.resolve({ id: 'server-d', text: 'D' });
    work.get('b')!.resolve({ id: 'server-b', text: 'B' });
    await vi.waitFor(() => expect(rows).toEqual([
      { id: 'server-b', text: 'B', pending: false },
      { id: 'server-c', text: 'C', pending: false },
      { id: 'server-d', text: 'D', pending: false },
    ]));
  });

  it('preserves a plain promise, gives each call an ID, and rolls back failures in settlement order', async () => {
    const work = new Map('abcdef'.split('').map(letter => [letter, deferred<string>()]));
    const ids = new Map<string, string>();
    const errors: string[] = [];
    let count = 0;
    const submit = optimistic({
      action: (letter: string) => work.get(letter)!.promise,
      apply(letter, id) {
        ids.set(letter, id);
        count++;
        return error => {
          count--;
          errors.push(`${letter}:${error.message}`);
        };
      },
    });

    for (const letter of 'abcdef') {
      expect(submit(letter)).toBe(work.get(letter)!.promise);
    }
    expect(count).toBe(6);
    expect(new Set(ids.values()).size).toBe(6);

    const failures = new Set(['b', 'e', 'f']);
    for (const letter of ['d', 'b', 'f', 'a', 'e', 'c']) {
      if (failures.has(letter)) work.get(letter)!.reject(new Error(`${letter} failed`));
      else work.get(letter)!.resolve(letter);
      await vi.waitFor(() => expect(count).toBe(
        6 - ['d', 'b', 'f', 'a', 'e', 'c'].slice(0, ['d', 'b', 'f', 'a', 'e', 'c'].indexOf(letter) + 1)
          .filter(item => failures.has(item)).length,
      ));
    }
    expect(count).toBe(3);
    expect(errors).toEqual(['b:b failed', 'f:f failed', 'e:e failed']);
  });

  it('tracks existing fetch sources directly and returns the exact source', async () => {
    const responses = new Map<string, ReturnType<typeof deferred<Response>>>();
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const key = String(new URL(String(input)).searchParams.get('id'));
      const response = deferred<Response>();
      responses.set(key, response);
      expect(init?.method).toBe('POST');
      return response.promise;
    });
    const runtime = createDataRuntime({
      baseURL: 'https://example.test',
      fetch: fetcher as typeof fetch,
    });
    let votes = 0;
    const ids: string[] = [];
    const failed: RequestError[] = [];
    const saved: number[] = [];
    const submit = optimistic({
      action: (id: string) => runtime.$fetch<number>(`/vote?id=${id}`, { method: 'POST' }),
      apply(_id, operationId) {
        ids.push(operationId);
        votes++;
        return error => {
          votes--;
          failed.push(error);
        };
      },
      reconcile(value) { saved.push(value); },
    });

    const first: FetchResource<number> = submit('first');
    const second = submit('second');
    const third = submit('third');
    expect(first.pending).toBe(true);
    expect(votes).toBe(3);
    expect(new Set(ids).size).toBe(3);
    await vi.waitFor(() => expect(responses.size).toBe(3));

    responses.get('second')!.resolve(Response.json(2));
    await vi.waitFor(() => expect(second.status).toBe('success'));
    responses.get('first')!.resolve(Response.json({ message: 'denied' }, { status: 409 }));
    await vi.waitFor(() => expect(first.status).toBe('error'));
    responses.get('third')!.resolve(Response.json(3));
    await vi.waitFor(() => expect(third.status).toBe('success'));

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(votes).toBe(2);
    expect(failed).toHaveLength(1);
    expect(saved).toEqual([2, 3]);
    expect(failed[0]).toMatchObject({ kind: 'http', status: 409, data: { message: 'denied' } });
    runtime.clear();
  });

  it('uses the same operation with a form and retains form submission errors', async () => {
    const work = new Map([['a', deferred<number>()], ['b', deferred<number>()]]);
    const schema: StandardSchemaV1<unknown, { id: string }> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate(value) {
          const id = (value as { id?: string }).id;
          return id === 'a' || id === 'b'
            ? { value: { id } }
            : { issues: [{ message: 'Invalid id', path: ['id'] }] };
        },
      },
    };
    let count = 0;
    const submit = optimistic({
      action: (fields: { id: string }) => work.get(fields.id)!.promise,
      apply() {
        count++;
        return () => { count--; };
      },
    });
    const form = $forms({ schema, action: submit });
    const fields = (id: string) => {
      const data = new FormData();
      data.set('id', id);
      return data;
    };

    form.submit(fields('invalid'));
    await vi.waitFor(() => expect(form.errors[0]?.kind).toBe('parse'));
    expect(count).toBe(0);

    form.submit(fields('a'));
    form.submit(fields('b'));
    await vi.waitFor(() => expect(count).toBe(2));
    expect(form.pending).toBe(true);
    work.get('b')!.reject(new Error('b rejected'));
    await vi.waitFor(() => expect(count).toBe(1));
    expect(form.errors).toMatchObject([{ kind: 'submit', message: 'b rejected' }]);
    work.get('a')!.resolve(1);
    await vi.waitFor(() => expect(form.pending).toBe(false));
    expect(count).toBe(1);
  });

  it('lets a server-side form settle a tracked fetch result as its payload', async () => {
    const fetcher = vi.fn(async () => Response.json({ id: 'saved-message' }));
    const runtime = createDataRuntime({
      baseURL: 'https://example.test',
      fetch: fetcher as typeof fetch,
    });
    const schema: StandardSchemaV1<unknown, { message: string }> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate(value) {
          return { value: { message: String((value as { message: string }).message) } };
        },
      },
    };
    let temporary = '';
    const submit = optimistic({
      action: (fields: { message: string }) => runtime.$fetch<{ id: string }>('/messages', {
        method: 'POST', body: { message: fields.message },
      }),
      apply(fields) {
        temporary = fields.message;
        return () => { temporary = ''; };
      },
      reconcile(saved) { temporary = saved.id; },
    });
    const form = $forms({ schema, action: submit });
    const data = new FormData();
    data.set('message', 'hello');
    form.submit(data);
    await vi.waitFor(() => expect(form.pending).toBe(false));
    expect(form.errors).toEqual([]);
    expect(form.result).toEqual({ id: 'saved-message' });
    expect(temporary).toBe('saved-message');
    expect(fetcher).toHaveBeenCalledOnce();
    runtime.clear();
  });

  it('rejects synchronous results and repeated source operations', async () => {
    const invalid = optimistic({
      action: (_value: string) => 1 as never,
      apply: () => () => {},
    });
    expect(() => invalid('x')).toThrow('trackable source or promise');

    const promise = Promise.resolve(1);
    const reusedPromise = optimistic({
      action: () => promise,
      apply: () => () => {},
    });
    expect(reusedPromise(undefined)).toBe(promise);
    expect(() => reusedPromise(undefined)).toThrow('new operation');

    const response = deferred<Response>();
    const runtime = createDataRuntime({
      baseURL: 'https://example.test',
      fetch: (() => response.promise) as typeof fetch,
    });
    const source = runtime.$fetch('/vote', { method: 'POST' });
    const submit = optimistic({ action: () => source, apply: () => () => {} });
    expect(submit(undefined)).toBe(source);
    expect(() => submit(undefined)).toThrow('new operation');
    response.resolve(Response.json({ ok: true }));
    await vi.waitFor(() => expect(source.status).toBe('success'));
    expect(() => submit(undefined)).toThrow('new operation');
    runtime.clear();
  });
});
