import { afterEach, describe, expect, it } from 'vitest';
import {
  collectRenderReadiness,
  createApplicationRuntime, runWithApplicationRuntime,
} from '@memoized-dom/runtime';
import { commit, markDirty, noteRenderReadiness, register, resetScheduler, setScheduler, unregister, _internals } from '@memoized-dom/runtime/testing';

afterEach(() => {
  for (const id of _internals().registry.keys()) unregister(id);
  commit();
  resetScheduler();
});

describe('scheduled publication readiness', () => {
  it('does not introduce a promise for an immediate publication without atomic work', () => {
    expect(collectRenderReadiness(() => {})).toBeUndefined();
  });
  it('does not flush a custom scheduler and discovers atomic work in its eventual drain', async () => {
    let flush = () => {};
    setScheduler(run => { flush = run; });
    let release!: () => void;
    const region = new Promise<void>(resolve => { release = resolve; });
    let renders = 0;
    register({ id: 'scheduled', parent: null, render: () => { renders++; noteRenderReadiness(region); } });
    const ready = collectRenderReadiness(() => markDirty('scheduled'));
    let settled = false;
    void ready!.then(() => { settled = true; });
    expect(renders).toBe(0);
    flush();
    await Promise.resolve();
    expect(renders).toBe(1);
    expect(settled).toBe(false);
    release();
    await ready;
    expect(settled).toBe(true);
  });
  it('includes child work revealed in later passes of the same drain', async () => {
    setScheduler(() => {});
    let release!: () => void;
    const region = new Promise<void>(resolve => { release = resolve; });
    register({ id: 'parent', parent: null, render: () => markDirty('parent/child') });
    register({ id: 'parent/child', parent: 'parent', render: () => noteRenderReadiness(region) });
    const ready = collectRenderReadiness(() => markDirty('parent'));
    commit();
    let settled = false;
    void ready!.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await ready;
    expect(settled).toBe(true);
  });
  it('rejects publication readiness with the original scheduled render failure', async () => {
    setScheduler(() => {});
    const error = new Error('Scheduled render failed');
    register({ id: 'failed', parent: null, render: () => { throw error; } });
    const ready = collectRenderReadiness(() => markDirty('failed'));
    expect(() => commit()).toThrow(error);
    await expect(ready).rejects.toBe(error);
    expect(collectRenderReadiness(() => {})).toBeUndefined();
  });
  it('keeps queued publications isolated between application runtimes', async () => {
    const first = createApplicationRuntime('first-publication');
    const second = createApplicationRuntime('second-publication');
    try {
      const firstReady = runWithApplicationRuntime(first, () => {
        setScheduler(() => {});
        register({ id: 'same', parent: null, render: () => {} });
        return collectRenderReadiness(() => markDirty('same'));
      });
      let firstSettled = false;
      void firstReady!.then(() => { firstSettled = true; });
      const secondReady = runWithApplicationRuntime(second, () => {
        setScheduler(() => {});
        register({ id: 'same', parent: null, render: () => {} });
        const ready = collectRenderReadiness(() => markDirty('same'));
        commit();
        return ready;
      });
      await secondReady;
      expect(firstSettled).toBe(false);
      runWithApplicationRuntime(first, commit);
      await firstReady;
      expect(firstSettled).toBe(true);
    } finally {
      first.dispose();
      second.dispose();
    }
  });
  it('rejects a publication if its runtime is disposed before a scheduled drain', async () => {
    const runtime = createApplicationRuntime('disposed-publication');
    const ready = runWithApplicationRuntime(runtime, () => {
      setScheduler(() => {});
      register({ id: 'pending', parent: null, render: () => {} });
      return collectRenderReadiness(() => markDirty('pending'));
    });
    runtime.dispose();
    await expect(ready).rejects.toMatchObject({ name: 'AbortError' });
    expect(runtime.state.registry.size).toBe(0);
  });
  it.each([false, true])('rejects a region wait after runtime disposal (scheduled: %s)', async scheduled => {
    const runtime = createApplicationRuntime(`disposed-region-${scheduled}`);
    let release!: () => void;
    const region = new Promise<void>(resolve => { release = resolve; });
    const ready = runWithApplicationRuntime(runtime, () => {
      if (!scheduled) return collectRenderReadiness(() => noteRenderReadiness(region));
      setScheduler(() => {});
      register({ id: 'pending', parent: null, render: () => noteRenderReadiness(region) });
      const ready = collectRenderReadiness(() => markDirty('pending'));
      commit();
      return ready;
    });
    runtime.dispose();
    await expect(ready).rejects.toMatchObject({ name: 'AbortError' });
    release();
    await expect(ready).rejects.toMatchObject({ name: 'AbortError' });
    expect(runtime.state.extensions.size).toBe(0);
  });
});
