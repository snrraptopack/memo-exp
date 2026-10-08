import { waitFor } from '../../../test-support/helpers';
import { describe, expect, it, vi } from 'bun:test';
import { $forms, $track, type StandardSchemaV1 } from '../src';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fields(id: string): FormData {
  const data = new FormData();
  data.set('id', id);
  return data;
}

describe('$forms', () => {
  it('runs on the server from FormData without browser DOM globals', async () => {
    const action = vi.fn((data: FormData) => String(data.get('id')));
    const form = $forms(action);
    const tracker = $track(form);

    expect(form.pending).toBe(false);
    form.submit(fields('first'));
    expect(tracker.id).toMatch(/^form-/);
    await waitFor(() => expect(form.pending).toBe(false));
    expect(action).toHaveBeenCalledTimes(1);
    expect(form.result).toBe('first');
    expect(form.errors).toEqual([]);
    expect(tracker).not.toHaveProperty('value');
  });

  it('keeps optimistic callbacks isolated across rapid out-of-order completions', async () => {
    const first = deferred<number>();
    const second = deferred<number>();
    const third = deferred<number>();
    const operations = new Map([
      ['a', first],
      ['b', second],
      ['c', third],
    ]);
    let votes = 0;
    const pending = new Set<string>();
    const callbacks: string[] = [];
    const form = $forms((data: FormData) => {
      const tracker = $track(form);
      const id = tracker.id;
      pending.add(id);
      votes++;
      tracker.onSuccess((_result, settledId) => {
        pending.delete(settledId);
        callbacks.push(`success:${settledId}`);
      });
      tracker.onError((_error, settledId) => {
        if (pending.delete(settledId)) votes--;
        callbacks.push(`error:${settledId}`);
      });
      return operations.get(String(data.get('id')))!.promise;
    });

    form.submit(fields('a'));
    const a = $track(form).id;
    form.submit(fields('b'));
    const b = $track(form).id;
    form.submit(fields('c'));
    const c = $track(form).id;
    expect(new Set([a, b, c]).size).toBe(3);
    expect(votes).toBe(3);
    expect(form.pending).toBe(true);

    second.resolve(2);
    await waitFor(() => expect(callbacks).toContain(`success:${b}`));
    expect(form.pending).toBe(true);
    expect(votes).toBe(3);
    expect(form.result).toBeUndefined();

    first.reject(new Error('a failed'));
    await waitFor(() => expect(callbacks).toContain(`error:${a}`));
    expect(form.pending).toBe(true);
    expect(votes).toBe(2);
    expect(form.errors).toEqual([]);

    third.resolve(3);
    await waitFor(() => expect(form.pending).toBe(false));
    expect(votes).toBe(2);
    expect(pending.size).toBe(0);
    expect(form.result).toBe(3);
    expect(callbacks).toHaveLength(3);
    expect(callbacks).toContain(`success:${c}`);
  });

  it('keeps latest submission errors visible and reports older failures only to their callbacks', async () => {
    const older = deferred<string>();
    const newer = deferred<string>();
    const failed: string[] = [];
    const form = $forms((data: FormData) => {
      $track(form).onError((_error, id) => failed.push(id));
      return data.get('id') === 'old' ? older.promise : newer.promise;
    });

    form.submit(fields('old'));
    const oldId = $track(form).id;
    form.submit(fields('new'));
    const newId = $track(form).id;
    newer.reject(new Error('new failed'));
    await waitFor(() => expect(failed).toContain(newId));
    expect(form.errors).toMatchObject([{ kind: 'submit', message: 'new failed' }]);

    older.reject(new Error('old failed'));
    await waitFor(() => expect(failed).toHaveLength(2));
    expect(failed).toContain(oldId);
    expect(form.errors).toMatchObject([{ kind: 'submit', message: 'new failed' }]);
  });

  it.each([
    [
      ['d', 'b', 'f', 'a', 'e', 'c'],
      new Set(['b', 'e']),
    ],
    [
      ['c', 'f', 'a', 'e', 'b', 'd'],
      new Set(['a', 'c', 'd']),
    ],
  ])('reconciles six rapid submissions settled in order %j', async (order, failures) => {
    const work = new Map('abcdef'.split('').map(letter => [letter, deferred<string>()]));
    const pending = new Set<string>();
    const ids = new Map<string, string>();
    const settled: string[] = [];
    let votes = 0;
    const form = $forms((data: FormData) => {
      const letter = String(data.get('id'));
      const tracker = $track(form);
      ids.set(letter, tracker.id);
      pending.add(tracker.id);
      votes++;
      tracker.onSuccess((_result, id) => {
        pending.delete(id);
        settled.push(id);
      });
      tracker.onError((_error, id) => {
        if (pending.delete(id)) votes--;
        settled.push(id);
      });
      return work.get(letter)!.promise;
    });

    for (const letter of 'abcdef') form.submit(fields(letter));
    expect(form.pending).toBe(true);
    expect(new Set(ids.values()).size).toBe(6);
    for (const [index, letter] of order.entries()) {
      const operation = work.get(letter)!;
      if (failures.has(letter)) operation.reject(new Error(`${letter} failed`));
      else operation.resolve(letter);
      await waitFor(() => expect(settled).toHaveLength(index + 1));
      expect(form.pending).toBe(index < order.length - 1);
      expect(pending.size).toBe(order.length - index - 1);
    }
    expect(votes).toBe(6 - failures.size);
    expect(new Set(settled).size).toBe(6);
    expect(form.result).toBe(failures.has('f') ? undefined : 'f');
    expect(form.errors.map(error => error.kind)).toEqual(failures.has('f') ? ['submit'] : []);
  });

  it('reports schema issues as parse errors and does not invoke the action', async () => {
    const schema: StandardSchemaV1<unknown, { id: number }> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate(value) {
          const id = (value as { id?: string }).id;
          return id === '42'
            ? { value: { id: 42 } }
            : { issues: [{ message: 'Invalid id', path: ['id'] }] };
        },
      },
    };
    const action = vi.fn((value: { id: number }) => value.id * 2);
    const form = $forms({ schema, action });
    form.submit(fields('bad'));
    await waitFor(() => expect(form.pending).toBe(false));
    expect(form.errors).toEqual([{ kind: 'parse', message: 'Invalid id', path: ['id'] }]);
    expect(action).not.toHaveBeenCalled();

    form.submit(fields('42'));
    await waitFor(() => expect(form.pending).toBe(false));
    expect(action).toHaveBeenCalledWith({ id: 42 });
    expect(form.result).toBe(84);
    expect(form.errors).toEqual([]);
  });
});
