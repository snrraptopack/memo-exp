/**
 * M5.7 — render-path constant factors.
 *
 * 1. undirty: a list row that is BOTH dirtied through the access table
 *    (Row[*] pattern) AND resynced by its parent's reconcile (M5.5
 *    entry.update) renders ONCE per commit, not twice.
 * 2. shape fast path: reconcile with the same keys in the same order
 *    performs zero structural DOM work and still syncs every row.
 * 3. cascade survives: marks added DURING a render (R10 setProps push)
 *    still reach a later pass of the same commit (the M5.7 commit keeps
 *    ids in the dirty set until they render — this must not eat cascades).
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
} from '@memoized-dom/runtime/testing';
import { installAccessTable, resetAccessTable } from '@memoized-dom/runtime/testing';
import { createListRegion } from '@memoized-dom/runtime/testing';
import { registerProps, setProps } from '@memoized-dom/runtime/testing';

function resetRegistry(): void {
  _internals().registry.forEach((_, id) => unregister(id));
  resetAccessTable();
}

describe('M5.7 — no double render for dirtied + resynced rows', () => {
  beforeEach(() => {
    resetRegistry();
    setScheduler((fn) => fn());
    document.body.innerHTML = '';
  });
  afterEach(() => resetScheduler());

  it('a Row[*]-dirtied inline row renders once per commit', () => {
    const renders = new Map<string, number>();
    const bump = (id: string) => renders.set(id, (renders.get(id) ?? 0) + 1);

    // parent with a 2-row list; rows also read state (Row[*] in the table)
    const ul = document.createElement('ul');
    document.body.appendChild(ul);
    let region!: ReturnType<typeof createListRegion<{ id: number }>>;
    register({
      id: 'App',
      parent: null,
      render: () => {
        bump('App');
        region.reconcile(items);
      },
    });
    region = createListRegion(ul, 'App/items', (item, rowId) => {
      const li = document.createElement('li');
      register({ id: rowId, parent: 'App', render: () => bump(rowId) });
      return { nodes: [li], entities: [rowId], update: () => bump(rowId) };
    }, (item) => item.id);

    let items = [{ id: 1 }, { id: 2 }];
    installAccessTable(
      { readers: { items: ['App', 'App/items/Row[*]'] } },
      'App',
    );

    // mount frame
    markDirty('App');
    commit();
    expect(renders.get('App')).toBe(1);

    // steady-state commit: table dirties App + both rows; reconcile resyncs
    // the rows (M5.5) — the pending row renders MUST be cancelled (M5.7).
    // (capturing scheduler: batch the three marks into ONE commit)
    renders.clear();
    let flush: (() => void) | null = null;
    setScheduler((fn) => {
      flush = fn;
    });
    items = [{ id: 1 }, { id: 2 }]; // same keys, same order
    markDirty('App');
    markDirty('App/items/Row[1]');
    markDirty('App/items/Row[2]');
    flush!();
    setScheduler((fn) => fn());
    expect(renders.get('App')).toBe(1);
    expect(renders.get('App/items/Row[1]') ?? 0).toBe(1); // not 2
    expect(renders.get('App/items/Row[2]') ?? 0).toBe(1); // not 2
  });

  it('shape fast path: zero structural DOM ops, rows still synced', () => {
    const ul = document.createElement('ul');
    document.body.appendChild(ul);
    const synced: string[] = [];
    const region = createListRegion(ul, 'App/items', (item: { id: number }, rowId) => {
      const li = document.createElement('li');
      return {
        nodes: [li],
        entities: [rowId],
        update: () => synced.push(rowId),
      };
    }, (item: { id: number }) => item.id);
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    region.reconcile(items);

    // spy on structural DOM operations
    const ops: string[] = [];
    const origInsert = ul.insertBefore.bind(ul);
    ul.insertBefore = ((n: Node, ref: Node | null) => {
      ops.push('insertBefore');
      return origInsert(n, ref);
    }) as typeof ul.insertBefore;

    synced.length = 0;
    region.reconcile([{ id: 1 }, { id: 2 }, { id: 3 }]); // same keys/order
    expect(ops).toEqual([]);
    expect(synced.sort()).toEqual([
      'App/items/Row[1]',
      'App/items/Row[2]',
      'App/items/Row[3]',
    ]);
  });

  it('commit cascade still reaches later passes (setProps push mid-commit)', () => {
    const order: string[] = [];
    register({
      id: 'P',
      parent: null,
      render: () => {
        order.push('P');
        setProps('P/C', [Math.random()]); // forces a child mark mid-commit
      },
    });
    register({
      id: 'P/C',
      parent: 'P',
      render: () => order.push('C'),
    });
    registerProps('P/C', [0]);

    markDirty('P');
    commit();
    expect(order).toEqual(['P', 'C']); // child rendered in the SAME commit
  });
});
