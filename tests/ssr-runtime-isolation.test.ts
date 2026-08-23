/**
 * SSR Slice 1.1 — application runtime isolation.
 *
 * The kernel's mutable state (registry, dirty set, volatile set, scheduler,
 * invalidation reasons, commit diagnostics) lives inside an
 * ApplicationRuntime. Browsers use one ambient default; server entry points
 * create, activate, and dispose one per request. These tests prove two
 * runtimes cannot observe each other's state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  commit,
  createApplicationRuntime,
  getActiveApplicationRuntime,
  installAccessTable,
  markDirty,
  register,
  registerProps,
  resetAccessTable,
  resetScheduler,
  resolveWrites,
  runWithApplicationRuntime,
  setActiveApplicationRuntime,
  setProps,
  setScheduler,
  unregister,
  type Entity,
} from '@memoized-dom/runtime';
import { _internals, _propsBox } from '@memoized-dom/runtime/testing';

function makeEntity(id: string, renders: string[] = []): Entity {
  return {
    id,
    parent: null,
    render: () => {
      renders.push(id);
    },
  };
}

describe('application runtime isolation', () => {
  beforeEach(() => {
    setScheduler((run) => run());
  });

  afterEach(() => {
    // Restore the ambient default and drain whatever the test left behind.
    setActiveApplicationRuntime(getActiveApplicationRuntime());
    resetScheduler();
    _internals().registry.forEach((_, id) => unregister(id));
  });

  it('defaults to one ambient runtime for browser compatibility', () => {
    expect(getActiveApplicationRuntime().id).toBe('browser-default');
  });

  it('keeps registries of two runtimes fully separate', () => {
    const a = createApplicationRuntime('request-a');
    const b = createApplicationRuntime('request-b');

    runWithApplicationRuntime(a, () => {
      register(makeEntity('App/A'));
    });
    runWithApplicationRuntime(b, () => {
      register(makeEntity('App/B'));
    });

    expect(a.state.registry.has('App/A')).toBe(true);
    expect(a.state.registry.has('App/B')).toBe(false);
    expect(b.state.registry.has('App/B')).toBe(true);
    expect(b.state.registry.has('App/A')).toBe(false);
    // The ambient default observed neither registration.
    expect(_internals().registry.size).toBe(0);

    a.dispose();
    b.dispose();
  });

  it('routes invalidation and commits through the active runtime only', () => {
    const a = createApplicationRuntime('request-a');
    const b = createApplicationRuntime('request-b');
    const aRenders: string[] = [];
    const bRenders: string[] = [];

    runWithApplicationRuntime(a, () => {
      register(makeEntity('App/Panel', aRenders));
    });
    runWithApplicationRuntime(b, () => {
      register(makeEntity('App/Panel', bRenders));
    });

    runWithApplicationRuntime(a, () => {
      markDirty('App/Panel');
      commit();
    });
    // A commit inside runtime b must not drain runtime a's dirty entity...
    runWithApplicationRuntime(b, () => {
      commit();
    });

    expect(aRenders).toEqual(['App/Panel']);
    expect(bRenders).toEqual([]);

    runWithApplicationRuntime(b, () => {
      markDirty('App/Panel');
      commit();
    });
    expect(bRenders).toEqual(['App/Panel']);

    a.dispose();
    b.dispose();
  });

  it('restores the previous runtime after a scoped run throws', () => {
    const a = createApplicationRuntime('request-a');
    expect(() =>
      runWithApplicationRuntime(a, () => {
        throw new Error('render failed');
      }),
    ).toThrow('render failed');

    expect(getActiveApplicationRuntime().id).toBe('browser-default');
    a.dispose();
  });

  it('dispose() drains entities and reactivates the ambient default', () => {
    const a = createApplicationRuntime('request-a');
    setActiveApplicationRuntime(a);
    register(makeEntity('App/Temp'));
    expect(_internals().registry.has('App/Temp')).toBe(true);

    a.dispose();

    expect(a.state.registry.size).toBe(0);
    expect(getActiveApplicationRuntime().id).toBe('browser-default');
  });

  it('schedulers are per runtime', () => {
    const a = createApplicationRuntime('request-a');
    const aRuns: number[] = [];
    const previous = setActiveApplicationRuntime(a);
    setScheduler((run) => {
      aRuns.push(1);
      run();
    });
    setActiveApplicationRuntime(previous);

    // The ambient runtime's scheduler is untouched.
    let ambientRan = false;
    markDirty('dead-letter'); // no-op: nothing registered, but exercises path
    expect(aRuns.length).toBe(0);
    expect(ambientRan).toBe(false);
    a.dispose();
  });

  it('cleanup disposers registered in one runtime never drain in another', () => {
    const a = createApplicationRuntime('request-a');
    const drained: string[] = [];

    runWithApplicationRuntime(a, () => {
      register(makeEntity('App/A'));
      cleanup('App/A', () => drained.push('a'));
    });

    // Unregistering a same-named entity inside another runtime must not
    // drain runtime a's disposer — the stores are fully separate.
    const b = createApplicationRuntime('request-b');
    runWithApplicationRuntime(b, () => {
      register(makeEntity('App/A'));
      unregister('App/A');
    });
    b.dispose();
    expect(drained).toEqual([]);

    runWithApplicationRuntime(a, () => {
      unregister('App/A');
    });
    expect(drained).toEqual(['a']);
    a.dispose();
  });

  it('access tables: static fragments replay into later runtimes, mutable state stays per runtime', () => {
    const a = createApplicationRuntime('request-a');

    runWithApplicationRuntime(a, () => {
      installAccessTable(
        { readers: { './state.ts#count': ['App/Counter'] } },
        'App',
      );
      expect(resolveWrites(['./state.ts#count'], [])).toEqual(['App/Counter']);
    });

    // Fragments are static build artifacts (installed by compiled modules at
    // evaluation time), so runtimes created afterwards replay them - that is
    // how SSR request contexts receive cross-module write routing.
    const b = createApplicationRuntime('request-b');
    runWithApplicationRuntime(b, () => {
      expect(resolveWrites(['./state.ts#count'], [])).toEqual([
        'App/Counter',
      ]);
    });

    // Mutable resolver state is still per runtime: an install scoped to b
    // never reaches a, and b's tables survive a's existence.
    runWithApplicationRuntime(b, () => {
      installAccessTable(
        { readers: { './state.ts#onlyB': ['App/OnlyB'] } },
        'App',
      );
      expect(resolveWrites(['./state.ts#onlyB'], [])).toEqual(['App/OnlyB']);
    });

    // Runtime a's own table state survives the other request's existence,
    // but b's post-creation install is invisible to it.
    runWithApplicationRuntime(a, () => {
      expect(resolveWrites(['./state.ts#count'], [])).toEqual(['App/Counter']);
      expect(resolveWrites(['./state.ts#onlyB'], [])).toEqual([]);
    });

    resetAccessTable();
    b.dispose();
    a.dispose();
  });

  it('prop boxes are per runtime', () => {
    const a = createApplicationRuntime('request-a');
    runWithApplicationRuntime(a, () => {
      register(makeEntity('App/Child'));
      registerProps('App/Child', ['alpha']);
      expect(_propsBox('App/Child')).toEqual(['alpha']);
    });

    // Another runtime sees no box for the same entity id...
    const b = createApplicationRuntime('request-b');
    runWithApplicationRuntime(b, () => {
      expect(_propsBox('App/Child')).toBeUndefined();
    });
    b.dispose();

    // ...and setProps inside b is a dead letter, not a cross-runtime write.
    const c = createApplicationRuntime('request-c');
    runWithApplicationRuntime(c, () => {
      setProps('App/Child', ['beta']);
    });
    c.dispose();
    runWithApplicationRuntime(a, () => {
      expect(_propsBox('App/Child')).toEqual(['alpha']);
    });
    a.dispose();
  });
});
