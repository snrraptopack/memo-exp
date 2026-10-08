import { waitFor } from '../test-support/helpers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import {
  cleanup, createApplicationRuntime, createRenderPreparation, getEntity,
  markDirty, mountRef, refAssign, register, registerEffect,
  runWithApplicationRuntime, setScheduler, unregister,
  type ApplicationRuntime,
} from '@memoized-dom/runtime/testing';

describe('detached render preparation lifecycle', () => {
  let runtime: ApplicationRuntime;
  beforeEach(() => {
    runtime = createApplicationRuntime('preparation-test', { document, schedule: null });
    runWithApplicationRuntime(runtime, () => setScheduler(run => run()));
  });
  afterEach(() => {
    runtime.dispose();
    document.body.replaceChildren();
  });
  const inRuntime = <T>(run: () => T): T => runWithApplicationRuntime(runtime, run);
  const root = (id = 'root') => register({ id, parent: null, render() {} });

  it('holds assignable refs and effects until explicit activation', () => {
    const preparation = inRuntime(() => createRenderPreparation());
    const node = document.createElement('input');
    let assigned: Node | null = null;
    const effect = vi.fn(() => { expect(assigned).toBe(node); });
    preparation.run(() => {
      root();
      cleanup('root', mountRef(node, refAssign(value => {
        assigned = value;
        return () => { assigned = null; };
      })));
      registerEffect('root/effect', 'root', effect);
    });
    expect(assigned).toBeNull();
    expect(effect).not.toHaveBeenCalled();
    document.body.append(node);
    preparation.activate();
    expect(assigned).toBe(node);
    expect(effect).toHaveBeenCalledTimes(1);
    preparation.activate();
    expect(effect).toHaveBeenCalledTimes(1);
    preparation.dispose();
    expect(assigned).toBeNull();
  });

  it('rolls back queued lifecycles without running setup or its teardown', () => {
    const preparation = inRuntime(() => createRenderPreparation());
    const ref = vi.fn();
    const effect = vi.fn();
    const subscription = vi.fn();
    preparation.run(() => {
      root();
      cleanup('root', subscription);
      cleanup('root', mountRef(document.createElement('div'), refAssign(ref)));
      registerEffect('root/effect', 'root', effect);
    });
    preparation.dispose();
    preparation.activate();
    expect(ref).not.toHaveBeenCalled();
    expect(effect).not.toHaveBeenCalled();
    expect(subscription).toHaveBeenCalledTimes(1);
    expect(inRuntime(() => getEntity('root'))).toBeUndefined();
    expect(() => preparation.run(() => {})).toThrow(/disposed preparation/);
  });

  it('holds authored ref callbacks even when their node is already connected', async () => {
    const preparation = inRuntime(() => createRenderPreparation());
    const node = document.createElement('div');
    document.body.append(node);
    const callback = vi.fn();
    preparation.run(() => { root(); cleanup('root', mountRef(node, callback)); });
    await Promise.resolve();
    expect(callback).not.toHaveBeenCalled();
    preparation.activate();
    await waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
  });

  it('resumes detached renders under the same preparation context', () => {
    const preparation = inRuntime(() => createRenderPreparation());
    const effect = vi.fn();
    const ref = vi.fn();
    preparation.run(() => register({
      id: 'root', parent: null,
      render() {
        expect(this.id).toBe('root');
        cleanup('root', mountRef(document.createElement('div'), refAssign(ref)));
        registerEffect('root/late', 'root', effect);
      },
    }));
    inRuntime(() => markDirty('root'));
    expect(ref).not.toHaveBeenCalled();
    expect(effect).not.toHaveBeenCalled();
    preparation.activate();
    expect(ref).toHaveBeenCalledTimes(1);
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('lets direct descendant renders inherit their pending owner', () => {
    const preparation = inRuntime(() => createRenderPreparation());
    const effect = vi.fn();
    preparation.run(() => root());
    inRuntime(() => registerEffect('root/late', 'root', effect));
    expect(effect).not.toHaveBeenCalled();
    preparation.activate();
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('does not activate a ready nested generation through a pending parent', () => {
    const outer = inRuntime(() => createRenderPreparation());
    const inner = outer.run(() => createRenderPreparation());
    const ref = vi.fn();
    const effect = vi.fn();
    outer.run(() => root());
    inner.run(() => {
      register({ id: 'root/child', parent: 'root', render() {} });
      cleanup('root/child', mountRef(document.createElement('div'), refAssign(ref)));
      registerEffect('root/child/effect', 'root/child', effect);
    });
    inner.activate();
    expect(inner.status).toBe('pending');
    expect(ref).not.toHaveBeenCalled();
    expect(effect).not.toHaveBeenCalled();
    outer.activate();
    expect(inner.status).toBe('active');
    expect(ref).toHaveBeenCalledTimes(1);
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('rejects activation before nested discovery is ready without releasing refs', () => {
    const outer = inRuntime(() => createRenderPreparation());
    const inner = outer.run(() => createRenderPreparation());
    const ref = vi.fn();
    outer.run(() => { root(); cleanup('root', mountRef(document.createElement('div'), refAssign(ref))); });
    expect(() => outer.activate()).toThrow(/nested preparation/);
    expect(outer.status).toBe('pending');
    expect(ref).not.toHaveBeenCalled();
    inner.activate();
    outer.activate();
    expect(ref).toHaveBeenCalledTimes(1);
  });

  it('drops refs belonging to a branch removed while preparing', () => {
    const preparation = inRuntime(() => createRenderPreparation());
    const ref = vi.fn();
    preparation.run(() => {
      root();
      register({ id: 'root/branch', parent: 'root', render() {} });
      cleanup('root/branch', mountRef(document.createElement('div'), refAssign(ref)));
    });
    inRuntime(() => unregister('root/branch'));
    preparation.activate();
    expect(ref).not.toHaveBeenCalled();
  });

  it('assigns every nested sibling ref before any nested effect runs', () => {
    const outer = inRuntime(() => createRenderPreparation());
    const left = outer.run(() => createRenderPreparation());
    const right = outer.run(() => createRenderPreparation());
    const calls: string[] = [];
    outer.run(() => root());
    left.run(() => {
      register({ id: 'root/left', parent: 'root', render() {} });
      cleanup('root/left', mountRef(document.createElement('div'), refAssign(() => { calls.push('left ref'); })));
      registerEffect('root/left/effect', 'root/left', () => { calls.push('left effect'); });
    });
    right.run(() => {
      register({ id: 'root/right', parent: 'root', render() {} });
      cleanup('root/right', mountRef(document.createElement('div'), refAssign(() => { calls.push('right ref'); })));
    });
    left.activate();
    right.activate();
    outer.activate();
    expect(calls).toEqual(['left ref', 'right ref', 'left effect']);
  });

  it('checks nested readiness recursively before publishing lifecycle work', () => {
    const outer = inRuntime(() => createRenderPreparation());
    const inner = outer.run(() => createRenderPreparation());
    const deepest = inner.run(() => createRenderPreparation());
    const ref = vi.fn();
    outer.run(() => { root(); cleanup('root', mountRef(document.createElement('div'), refAssign(ref))); });
    inner.activate();
    expect(() => outer.activate()).toThrow(/nested preparation/);
    expect(ref).not.toHaveBeenCalled();
    deepest.activate();
    outer.activate();
    expect(ref).toHaveBeenCalledTimes(1);
  });

  it('cancels conditional effects removed before activation', () => {
    const preparation = inRuntime(() => createRenderPreparation());
    const effect = vi.fn();
    preparation.run(() => { root(); registerEffect('root/removed', 'root', effect); });
    inRuntime(() => unregister('root/removed'));
    preparation.activate();
    expect(effect).not.toHaveBeenCalled();
  });

  it('prevents a disposed runtime from activating a queued ref', () => {
    const preparation = inRuntime(() => createRenderPreparation());
    const ref = vi.fn();
    preparation.run(() => { root(); cleanup('root', mountRef(document.createElement('div'), refAssign(ref))); });
    runtime.dispose();
    preparation.activate();
    expect(ref).not.toHaveBeenCalled();
    expect(preparation.status).toBe('disposed');
  });

  it('rejects collisions without disturbing already-mounted instances', () => {
    const preparation = inRuntime(() => createRenderPreparation());
    const original = { id: 'root', parent: null, render() {} };
    inRuntime(() => register(original));
    expect(() => preparation.run(() => root())).toThrow(/overwrite live entity/);
    preparation.dispose();
    expect(inRuntime(() => getEntity('root'))).toBe(original);
  });

  it('rolls back all registered work when a ref fails during activation', () => {
    const preparation = inRuntime(() => createRenderPreparation());
    const teardown = vi.fn();
    const effect = vi.fn();
    preparation.run(() => {
      root();
      cleanup('root', teardown);
      cleanup('root', mountRef(document.createElement('div'), refAssign(() => { throw new Error('bad ref'); })));
      registerEffect('root/effect', 'root', effect);
    });
    expect(() => preparation.activate()).toThrow('bad ref');
    expect(preparation.status).toBe('disposed');
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(effect).not.toHaveBeenCalled();
    expect(inRuntime(() => getEntity('root'))).toBeUndefined();
  });

  it('keeps concurrent runtimes and identical entity IDs isolated', () => {
    const other = createApplicationRuntime('other', { document, schedule: null });
    try {
      const left = inRuntime(() => createRenderPreparation());
      const right = runWithApplicationRuntime(other, () => createRenderPreparation());
      const leftRef = vi.fn();
      const rightRef = vi.fn();
      left.run(() => { root(); cleanup('root', mountRef(document.createElement('div'), refAssign(leftRef))); });
      right.run(() => { root(); cleanup('root', mountRef(document.createElement('div'), refAssign(rightRef))); });
      left.activate();
      expect(leftRef).toHaveBeenCalledTimes(1);
      expect(rightRef).not.toHaveBeenCalled();
      right.dispose();
      expect(rightRef).not.toHaveBeenCalled();
    } finally { other.dispose(); }
  });

  it('automatically abandons partial creation when rendering throws', () => {
    const preparation = inRuntime(() => createRenderPreparation());
    const teardown = vi.fn();
    expect(() => preparation.run(() => {
      root();
      cleanup('root', teardown);
      throw new Error('render failed');
    })).toThrow('render failed');
    expect(preparation.status).toBe('disposed');
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(inRuntime(() => getEntity('root'))).toBeUndefined();
  });

  it('does not treat a mounted effect exception as a preparation crash', () => {
    const preparation = inRuntime(() => createRenderPreparation());
    preparation.run(() => {
      root();
      registerEffect('root/effect', 'root', () => { throw new Error('effect failed'); });
    });
    expect(() => preparation.activate()).toThrow('effect failed');
    expect(preparation.status).toBe('active');
    expect(inRuntime(() => getEntity('root'))).toBeDefined();
  });

  it('preserves a render failure alongside rollback failures', () => {
    const preparation = inRuntime(() => createRenderPreparation());
    let error: unknown;
    try {
      preparation.run(() => {
        root();
        cleanup('root', () => { throw new Error('rollback failed'); });
        throw new Error('render failed');
      });
    } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors.map((cause: Error) => cause.message))
      .toEqual(['render failed', 'rollback failed']);
    expect(preparation.status).toBe('disposed');
    expect(inRuntime(() => getEntity('root'))).toBeUndefined();
  });

  it('disposes unrelated runtime roots even when a cleanup fails', () => {
    const otherRootCleanup = vi.fn();
    inRuntime(() => {
      root();
      root('sibling');
      cleanup('root', () => { throw new Error('cleanup failed'); });
      cleanup('sibling', otherRootCleanup);
    });
    expect(() => runtime.dispose()).toThrow('cleanup failed');
    expect(otherRootCleanup).toHaveBeenCalledTimes(1);
    expect(runtime.state.registry.size).toBe(0);
    expect(runtime.state.extensions.size).toBe(0);
  });
});
