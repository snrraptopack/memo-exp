import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  _internals, commitListItemWrites, commitStructuralWrites, commitWrites,
  commitWritesWithPayload, installAccessTable, listItemIndices, listStructureReason, markDirty,
  register, resetAccessTable, resetScheduler, setScheduler, undirty, unregister,
  type DirtyReasons,
} from '@memoized-dom/runtime/testing';

beforeEach(() => {
  _internals().registry.forEach((_, id) => unregister(id));
  resetAccessTable();
});
afterEach(() => resetScheduler());

it('batches readers before rendering the parent, allowing row resync to cancel duplicates', () => {
  const renders: string[] = [];
  register({ id: 'App', parent: null, render: () => {
    renders.push('parent');
    renders.push('resynced row');
    undirty('App/Row[1]');
    markDirty('App/Badge');
  } });
  register({ id: 'App/Row[1]', parent: 'App', render: () => renders.push('row') });
  register({ id: 'App/Badge', parent: 'App', render: () => renders.push('badge') });
  installAccessTable({ readers: { items: ['App/Row[*]', 'App'] } }, 'App');
  let commits = 0;
  setScheduler(fn => { commits++; fn(); });

  commitWrites(['items']);

  expect(renders).toEqual(['parent', 'resynced row', 'badge']);
  expect(commits).toBe(1);
});

it('retains item and structural reasons for every resolved reader', () => {
  const reasons: DirtyReasons[] = [];
  for (const id of ['App', 'App/Other']) {
    register({ id, parent: id === 'App' ? null : 'App', render: reason => reasons.push(reason ?? null) });
  }
  installAccessTable({ readers: {
    items: ['App', 'App/Other'],
    'items\0memo-dom:list-structure-reader': ['App', 'App/Other'],
  } }, 'App');
  let commits = 0;
  setScheduler(fn => { commits++; fn(); });

  commitListItemWrites('items', [2]);
  expect(reasons).toHaveLength(2);
  expect(listItemIndices(reasons[0]!, 'items')).toEqual([2]);
  expect(listItemIndices(reasons[1]!, 'items')).toEqual([2]);
  reasons.length = 0;
  commitStructuralWrites(['items']);
  expect(reasons).toEqual([listStructureReason('items'), listStructureReason('items')]);
  expect(commits).toBe(2);
});

it('batches payload readers and ignores unmounted exact readers', () => {
  const renders: string[] = [];
  for (const id of ['App', 'App/Row[n:1]']) {
    register({ id, parent: id === 'App' ? null : 'App', render: () => renders.push(id) });
  }
  installAccessTable({ readers: { items: ['App', 'App/Row[n:1]', 'App/Missing'] } }, 'App');
  let commits = 0;
  setScheduler(fn => { commits++; fn(); });

  commitWritesWithPayload(['items'], {});
  expect(renders).toEqual(['App', 'App/Row[n:1]']);
  expect(commits).toBe(1);
  commitWrites(['unknown']);
  expect(commits).toBe(1);
});

it('merges item reasons under a deferred scheduler and lets a full write dominate', () => {
  const reasons: unknown[] = [];
  register({ id: 'App', parent: null, render: reason => reasons.push(reason) });
  installAccessTable({ readers: { items: ['App'] } }, 'App');
  let flush!: () => void;
  let commits = 0;
  setScheduler(fn => { commits++; flush = fn; });

  commitListItemWrites('items', [1]);
  commitListItemWrites('items', [2]);
  expect(reasons).toEqual([]);
  flush();
  expect(reasons[0]).toBeInstanceOf(Set);
  expect((reasons[0] as Set<unknown>).size).toBe(2);
  reasons.length = 0;
  commitListItemWrites('items', [1]);
  commitWrites(['items']);
  flush();
  expect(reasons).toEqual([null]);
  expect(commits).toBe(2);
});
