import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup, createApplicationRuntime, createPreparedRegion, getEntity, markDirty,
  mountRef, readPreparationScope, refAssign, register, runWithApplicationRuntime, setScheduler,
  type ApplicationRuntime,
} from '@memoized-dom/runtime/testing';

describe('atomic range failure ownership', () => {
  let runtime: ApplicationRuntime;
  const inRuntime = <T>(run: () => T): T => runWithApplicationRuntime(runtime, run);
  beforeEach(() => {
    runtime = createApplicationRuntime('atomic-errors', { document, schedule: null });
    inRuntime(() => setScheduler(run => run()));
  });
  afterEach(() => { runtime.dispose(); document.body.replaceChildren(); });
  const text = (value: string) => ({ nodes: [document.createTextNode(value)], update() {} });

  it('rolls back a partial factory and retries with fresh owners, deduplicating clicks', async () => {
    let attempt = 0;
    const disposed = vi.fn();
    const ref = vi.fn();
    const cause = new Error('partial render');
    let retry!: () => Promise<void>;
    const region = inRuntime(() => createPreparedRegion(document.body, 'unit', () => {
      attempt++;
      register({ id: 'unit', parent: null, render() {} });
      cleanup('unit', disposed);
      cleanup('unit', mountRef(document.createElement('input'), refAssign(ref)));
      if (attempt === 1) throw cause;
      return text('Ready');
    }, () => text('Pending'), (error, again) => { expect(error).toBe(cause); retry = again; return text('Failed'); }));
    expect(region.status).toBe('error');
    expect(runtime.state.registry.size).toBe(0);
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(ref).not.toHaveBeenCalled();
    const first = retry();
    expect(retry()).toBe(first);
    await first;
    expect(attempt).toBe(2);
    expect(region.status).toBe('active');
    expect(document.body.textContent).toBe('Ready');
    expect(ref).toHaveBeenCalledTimes(1);
    await retry(); // Retry captured by the retired error arm is inert.
    expect(attempt).toBe(2);
    region.dispose();
    expect(disposed).toHaveBeenCalledTimes(2);
  });

  it('handles a queued staged render failure and releases subscriptions before error UI', async () => {
    let status: 'pending' | 'error' = 'pending';
    let invalidate = () => {};
    const unsubscribe = vi.fn();
    const cause = new Error('download failed');
    const dependency = { key: {}, snapshot: () => ({ status, error: cause }),
      subscribe(run: () => void) { invalidate = run; return unsubscribe; } };
    const region = inRuntime(() => createPreparedRegion(document.body, 'unit', () => {
      const render = () => readPreparationScope('unit', 'read', () => {
        getEntity('unit')!.preparation!.consume(dependency);
        if (status === 'error') throw cause;
      });
      register({ id: 'unit', parent: null, render });
      render();
      return text('Hidden');
    }, () => text('Pending'), error => {
      expect(error).toBe(cause);
      expect(runtime.state.registry.size).toBe(0);
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      return text('Failed');
    }));
    status = 'error';
    expect(() => invalidate()).not.toThrow();
    expect(region.status).toBe('error');
    expect(document.body.textContent).toBe('Failed');
    region.dispose();
  });

  it('invalidates queued retry and lifecycle release when the region is abandoned', async () => {
    const create = vi.fn(() => { throw new Error('failed'); });
    let retry!: () => Promise<void>;
    const region = inRuntime(() => createPreparedRegion(document.body, 'unit', create, undefined,
      (_error, again) => { retry = again; return text('Failed'); }));
    const attempt = retry();
    region.dispose();
    await attempt;
    expect(create).toHaveBeenCalledTimes(1);
    expect(document.body.childNodes).toHaveLength(0);
    await retry();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('remounts an owned committed slot after a render crash without disposing a sibling', async () => {
    let crash = false;
    let creates = 0;
    inRuntime(() => register({ id: 'sibling', parent: null, render() {} }));
    const region = inRuntime(() => createPreparedRegion(document.body, 'unit', () => {
      creates++;
      register({ id: 'unit', parent: null, render() { if (crash) throw new Error('crash'); } });
      return text('Ready');
    }, undefined, () => text('Failed')));
    if ('settled' in region) await region.settled;
    crash = true;
    inRuntime(() => markDirty('unit'));
    expect(region.status).toBe('error');
    expect(document.body.textContent).toBe('Failed');
    expect(inRuntime(() => getEntity('sibling'))).toBeDefined();
    crash = false;
    if ('retry' in region) await region.retry!();
    expect(creates).toBe(2);
    expect(document.body.textContent).toBe('Ready');
    region.dispose();
  });
});
