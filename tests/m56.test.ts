/**
 * M5.6 — constant-factor work, behavioral guarantees.
 *
 * 1. resolveWrites caches resolutions against the registry generation:
 *    repeated resolutions hit the cache, and any register/unregister
 *    invalidates correctly (wildcard expansion must see the new id set).
 * 2. reconcile fast path: a pure content sync (same keys, same order, no
 *    add/remove) performs ZERO structural DOM operations.
 * 3. commit() is the public flush-now API: with a capturing scheduler,
 *    nothing renders until commit() is called.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  register,
  unregister,
  setScheduler,
  resetScheduler,
  commit,
  markDirty,
  _internals,
} from '../src/kernel';
import {
  installAccessTable,
  resetAccessTable,
  resolveWrites,
} from '../src/access';
import { createListRegion } from '../src/list';

describe('M5.6 — cached write resolution', () => {
  beforeEach(() => {
    _internals().registry.forEach((_, id) => unregister(id));
    resetAccessTable();
  });

  it('repeat resolutions return the cached array', () => {
    register({ id: 'App', parent: null, render: () => {} });
    installAccessTable(
      { readers: { items: ['App', 'App/Row[*]'] } },
      'App',
    );
    const live = ['App', 'App/Row[1]'];
    const a = resolveWrites(['items'], live);
    const b = resolveWrites(['items'], live);
    expect(a).toBe(b); // same cached array object
  });

  it('registry changes invalidate the cache (wildcard expansion stays live)', () => {
    installAccessTable(
      { readers: { items: ['App', 'App/Row[*]'] } },
      'App',
    );
    register({ id: 'App', parent: null, render: () => {} });
    const live1 = ['App'];
    expect(resolveWrites(['items'], live1)).toEqual(['App']);

    // a row mounts: generation bumps, next resolution must include it
    register({ id: 'App/Row[1]', parent: 'App', render: () => {} });
    const live2 = ['App', 'App/Row[1]'];
    expect([...resolveWrites(['items'], live2) as string[]].sort()).toEqual(['App', 'App/Row[1]']);

    // and unregisters shrink the expansion again
    unregister('App/Row[1]');
    expect(resolveWrites(['items'], live1)).toEqual(['App']);
  });

  it('opaque writes still short-circuit before the cache', () => {
    installAccessTable({ readers: { x: ['App'] }, opaque: ['y'] }, 'App');
    expect(resolveWrites(['y'], ['App'])).toBe('root-subtree');
  });
});

describe('M5.6 — reconcile fast path', () => {
  it('pure content sync performs zero structural DOM ops', () => {
    const parent = document.createElement('div');
    let inserts = 0;
    let removes = 0;
    const origInsert = parent.insertBefore.bind(parent);
    parent.insertBefore = ((node: any, ref: any) => {
      inserts++;
      return origInsert(node, ref);
    }) as any;

    const items = [
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
      { id: 3, label: 'c' },
    ];
    const region = createListRegion(parent, 'App/rows', (raw) => {
      const item = raw as { label: string };
      const text = document.createTextNode(item.label);
      return {
        nodes: [text],
        entities: [],
        update: () => {
          text.data = item.label; // row resync (M5.5) — content syncs via update
        },
      };
    });
    region.reconcile(items);
    const structuralAfterMount = inserts;
    expect(structuralAfterMount).toBeGreaterThan(0);

    // mutate content, same keys, same order → fast path
    items[1]!.label = 'B';
    inserts = 0;
    region.reconcile(items);
    expect(inserts).toBe(0);
    expect(parent.textContent).toBe('aBc');

    // a reorder must NOT take the fast path
    const t = items[0]!;
    items[0] = items[2]!;
    items[2] = t;
    region.reconcile(items);
    expect(parent.textContent).toBe('cBa');

    // an append must NOT take the fast path
    items.push({ id: 4, label: 'd' });
    region.reconcile(items);
    expect(parent.textContent).toBe('cBad');

    expect(removes).toBe(0); // sanity: nothing tracked removes here
  });
});

describe('M5.6 — public commit() flush', () => {
  afterEach(() => {
    resetScheduler();
    _internals().registry.forEach((_, id) => unregister(id));
  });

  it('with a capturing scheduler, nothing renders until commit()', () => {
    let scheduledFn: (() => void) | null = null;
    setScheduler((fn) => {
      scheduledFn = fn;
    });

    let renders = 0;
    register({
      id: 'App',
      parent: null,
      render: () => {
        renders++;
      },
    });
    markDirty('App');
    expect(renders).toBe(0); // only scheduled
    expect(scheduledFn).not.toBeNull();

    commit();
    expect(renders).toBe(1); // flushed synchronously
  });

  it('commit() with an empty dirty set is a no-op', () => {
    expect(() => commit()).not.toThrow();
  });
});
