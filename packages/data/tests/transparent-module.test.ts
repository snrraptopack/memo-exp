/**
 * RFC §16.4 — module sources are immutable descriptions materialized lazily
 * per ApplicationRuntime. Two concurrent runtimes over one described key
 * must get independent instances and independent request state.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createApplicationRuntime,
  runWithApplicationRuntime,
} from '@memoized-dom/runtime';
import {
  createDataRuntime,
  getActiveDataRuntime,
  setActiveDataRuntime,
  $ops,
  $track,
} from '../src';
import {
  readResolvedValue,
  readResolvedValueForRender,
} from '../src/transparent';
import {
  describeModuleSource,
  resolveModuleSource,
  sourceRef,
} from '../src/transparent-module';

interface User {
  id: number;
  name: string;
}

const KEY = './session.ts#currentUser';

function neverRuntime(): { runtime: DataRuntime; calls: () => number } {
  const state = { count: 0 };
  const runtime = createDataRuntime({
    fetch: (() => {
      state.count++;
      return new Promise<Response>(() => {});
    }) as typeof fetch,
  });
  return { runtime, calls: () => state.count };
}

function deferredRuntime(): {
  runtime: DataRuntime;
  resolve: (payload: unknown) => void;
} {
  let resolve!: (response: Response) => void;
  const runtime = createDataRuntime({
    fetch: (() => new Promise<Response>((accept) => { resolve = accept; })) as typeof fetch,
  });
  return {
    runtime,
    resolve: (payload: unknown) =>
      resolve(
        new Response(JSON.stringify(payload), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
  };
}

describe('module transparent sources', () => {
  it('materializes lazily and independently per ApplicationRuntime', () => {
    const a = neverRuntime();
    const b = neverRuntime();

    describeModuleSource<User>(KEY, () =>
      getActiveDataRuntime().$fetch<User>('/api/session') as ResolvedValue<User>,
    );
    const ref = sourceRef(KEY);

    const runtimeA = createApplicationRuntime('mod-a');
    const runtimeB = createApplicationRuntime('mod-b');

    // Each runtime materializes its own instance on first touch; both start
    // pending under a never-settling fetch. Request dispatch is deferred one
    // microtask by abortable(), so yield before counting.
    const tick = () => new Promise<void>((done) => setTimeout(done, 0));
    runWithApplicationRuntime(runtimeA, () => {
      setActiveDataRuntime(a.runtime);
      expect(readResolvedValueForRender(ref)).toBeUndefined();
    });
    runWithApplicationRuntime(runtimeB, () => {
      setActiveDataRuntime(b.runtime);
      expect(readResolvedValueForRender(ref)).toBeUndefined();
    });
    await tick();

    expect(a.calls()).toBe(1);
    expect(b.calls()).toBe(1);

    // Instances are cached per runtime — resolution reuses them.
    runWithApplicationRuntime(runtimeA, () => {
      setActiveDataRuntime(a.runtime);
      expect(resolveModuleSource(ref)).toBe(resolveModuleSource(ref));
    });

    runtimeA.dispose();
    runtimeB.dispose();
  });

  it('keeps request state independent between runtimes', async () => {
    const settled = {
      runtime: createDataRuntime({
        fetch: (() => new Promise<Response>(() => {})) as typeof fetch,
      }),
    };
    const pending = neverRuntime();

    describeModuleSource<User>(KEY, () =>
      getActiveDataRuntime().$fetch<User>('/api/session') as ResolvedValue<User>,
    );
    const ref = sourceRef(KEY);

    const runtimeA = createApplicationRuntime('state-a');
    const runtimeB = createApplicationRuntime('state-b');

    runWithApplicationRuntime(runtimeA, () => {
      setActiveDataRuntime(settled.runtime);
      const user = resolveModuleSource(ref);
      $ops(user as ResolvedValue<User>).update(() => ({
        id: 1,
        name: 'From-A',
      }));
    });

    runWithApplicationRuntime(runtimeA, () => {
      setActiveDataRuntime(settled.runtime);
      expect($track(readResolvedValue(ref)).pending).toBe(false);
      expect(readResolvedValue(ref).name).toBe('From-A');
    });

    // Runtime B materializes its OWN pending instance.
    runWithApplicationRuntime(runtimeB, () => {
      setActiveDataRuntime(pending.runtime);
      const user = resolveModuleSource(ref);
      expect($track(user as ResolvedValue<User>).pending).toBe(true);
      expect(readResolvedValueForRender(ref)).toBeUndefined();
    });

    // A's committed value does not leak into B.
    runWithApplicationRuntime(runtimeB, () => {
      setActiveDataRuntime(pending.runtime);
      expect(readResolvedValueForRender(ref)).toBeUndefined();
    });

    runtimeA.dispose();
    runtimeB.dispose();
  });

  it('$track and $ops observe and operate through the ref', () => {
    const { runtime, calls } = neverRuntime();
    const previous = setActiveDataRuntime(runtime);

    describeModuleSource<User>(KEY, () =>
      getActiveDataRuntime().$fetch<User>('/api/session') as ResolvedValue<User>,
    );
    const ref = sourceRef(KEY);

    const state = $track(ref);
    expect(state.pending).toBe(true);
    expect(state.status).toBe('pending');

    $ops(ref).update((current) => ({
      ...(current ?? { id: 0 }),
      name: 'Local',
    }));
    expect($track(ref).status).toBe('success');
    void calls;

    setActiveDataRuntime(previous);
  });

  it('throws when resolving an undescribed key', () => {
    const ghost = sourceRef('./nowhere.ts#ghost');
    expect(() => resolveModuleSource(ghost)).toThrow(
      /no registered description/,
    );
  });
});
