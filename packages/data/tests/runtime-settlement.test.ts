import { describe, expect, it, vi } from 'vitest';
import { createDataRuntime, getActiveDataRuntime, runWithDataRuntime } from '../src';
import { subscribeFetchResource } from '../src/resource';
import type { FetchResource } from '../src';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('data runtime provider settlement', () => {
  it('waits for a promise read started by a fetch completion', async () => {
    const response = deferred<Response>();
    const later = deferred<string>();
    const runtime = createDataRuntime({ fetch: (() => response.promise) as typeof fetch });
    const fetched = runtime.$fetch('/user');
    let read: FetchResource<string> | undefined;
    const unsubscribe = subscribeFetchResource(fetched, snapshot => {
      if (snapshot.status === 'success' && read === undefined) read = runtime.$read(later.promise);
    });
    let finished = false;
    const settlement = runtime.settle(2000).then(result => { finished = true; return result; });
    try {
      response.resolve(Response.json({ name: 'Ada' }));
      await vi.waitFor(() => expect(read?.pending).toBe(true));
      expect(finished).toBe(false);
      later.resolve('Complete');
      await expect(settlement).resolves.toBe(true);
      expect(read?.data).toBe('Complete');
    } finally {
      later.resolve('Complete');
      unsubscribe();
      runtime.clear();
    }
  });

  it('waits for a fetch started by a promise read completion', async () => {
    const initial = deferred<string>();
    const response = deferred<Response>();
    const runtime = createDataRuntime({ fetch: (() => response.promise) as typeof fetch });
    const read = runtime.$read(initial.promise);
    let fetched: FetchResource<unknown> | undefined;
    const unsubscribe = subscribeFetchResource(read, snapshot => {
      if (snapshot.status === 'success' && fetched === undefined) fetched = runtime.$fetch('/user');
    });
    let finished = false;
    const settlement = runtime.settle(2000).then(result => { finished = true; return result; });
    try {
      initial.resolve('Start');
      await vi.waitFor(() => expect(fetched?.pending).toBe(true));
      expect(finished).toBe(false);
      response.resolve(Response.json({ name: 'Ada' }));
      await expect(settlement).resolves.toBe(true);
      expect(fetched?.data).toEqual({ name: 'Ada' });
    } finally {
      response.resolve(Response.json({ name: 'Ada' }));
      unsubscribe();
      runtime.clear();
    }
  });

  it('keeps runtime identity, isolates reads and reuses a cleared boundary', async () => {
    const left = createDataRuntime();
    const right = createDataRuntime();
    const old = deferred<string>();
    const stale = left.$read(old.promise);
    const other = right.$read(Promise.resolve('Right'));
    expect(runWithDataRuntime(left, () => getActiveDataRuntime())).toBe(left);
    left.clear();
    const current = left.$read(Promise.resolve('Left'));
    old.resolve('Stale');
    await expect(left.settle()).resolves.toBe(true);
    await expect(right.settle()).resolves.toBe(true);
    expect(stale.data).toBeUndefined();
    expect(current.data).toBe('Left');
    expect(other.data).toBe('Right');
    left.clear();
    right.clear();
  });

  it('times out pending work and clears its deadline timer', async () => {
    vi.useFakeTimers();
    const later = deferred<string>();
    const runtime = createDataRuntime();
    runtime.$read(later.promise);
    try {
      const settlement = runtime.settle(25);
      await vi.advanceTimersByTimeAsync(25);
      await expect(settlement).resolves.toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      later.resolve('Done');
      await expect(runtime.settle(25)).resolves.toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      later.resolve('Done');
      runtime.clear();
      vi.useRealTimers();
    }
  });
});
