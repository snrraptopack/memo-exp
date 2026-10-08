import { afterEach, expect, it } from 'bun:test';
import {
  cleanup, createListRegion, markDirty, register, registeredIds,
  resetScheduler, setScheduler, unregister,
} from '@memoized-dom/runtime/testing';

afterEach(() => {
  resetScheduler();
  for (const id of registeredIds()) if (id.startsWith('dispose-errors/')) {
    try { unregister(id); } catch {}
  }
  document.body.replaceChildren();
});

it('finishes every row and entity cleanup before reporting failures', () => {
  const host = document.createElement('ul'); document.body.append(host);
  const calls: string[] = [];
  const entryError = new Error('entry'); const entityError = new Error('entity');
  const region = createListRegion(host, 'dispose-errors/all', (item: number, id) => {
    const node = document.createElement('li');
    for (const suffix of ['a', 'b']) {
      const entity = `${id}/${suffix}`;
      register({ id: entity, parent: null, render() {} });
      cleanup(entity, () => {
        calls.push(`${item}/${suffix}`);
        if (item === 1 && suffix === 'a') throw entityError;
      });
    }
    return { nodes: node, entities: [`${id}/a`, `${id}/b`], dispose() {
      calls.push(String(item)); if (item === 1) throw entryError;
    } };
  });
  region.reconcile([1, 2, 3]);
  let caught: unknown;
  try { region.dispose(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(AggregateError);
  expect((caught as AggregateError).errors).toEqual([entryError, entityError]);
  expect(calls).toEqual(['1', '1/a', '1/b', '2', '2/a', '2/b', '3', '3/a', '3/b']);
  expect(registeredIds().filter(id => id.startsWith('dispose-errors/'))).toEqual([]);
  expect(host.childNodes).toHaveLength(0); expect(region.size()).toBe(0);
  region.dispose(); expect(calls).toHaveLength(9);
});

it('blocks reentrant disposal and updates, and cancels scheduled row renders', () => {
  const scheduled: Array<() => void> = []; setScheduler(fn => scheduled.push(fn));
  const host = document.createElement('ul'); document.body.append(host);
  const calls: number[] = []; let renders = 0; let created = 0;
  const region = createListRegion(host, 'dispose-errors/reentrant', (item: number, id) => {
    created++;
    const node = document.createElement('li'); node.textContent = String(item);
    register({ id, parent: null, render() { renders++; } });
    markDirty(id);
    return { nodes: node, entities: [id], update() { renders++; }, dispose() {
      calls.push(item);
      if (item === 1) {
        expect(region.size()).toBe(0);
        region.dispose(); region.refreshKey(2); region.refreshIndices([1, 2], [1], true);
        region.reconcile([3]);
      }
    } };
  });
  region.reconcile([1, 2]); renders = 0;
  region.dispose(); for (const fn of scheduled) fn();
  expect(calls).toEqual([1, 2]); expect(renders).toBe(0); expect(created).toBe(2);
  expect(host.childNodes).toHaveLength(0);
  region.reconcile([4]); region.refreshKey(1); region.refreshIndices([4], [0]);
  expect(created).toBe(2); expect(region.size()).toBe(0);
});

it('preserves a single cleanup error while finishing interrupted-frame ownership', () => {
  const host = document.createElement('ul'); document.body.append(host);
  const error = new Error('cleanup'); const calls: number[] = [];
  const region = createListRegion(host, 'dispose-errors/failed', (item: number, id) => {
    const node = document.createElement('li'); register({ id, parent: null, render() {} });
    return { nodes: node, entities: [id], dispose() { calls.push(item); if (item === 1) throw error; } };
  }, (item: number) => { if (item === 9) throw new Error('key'); return item; });
  region.reconcile([1, 2]);
  expect(() => region.reconcile([3, 1, 9])).toThrow('key');
  expect(() => region.dispose()).toThrow(error);
  expect(calls.sort()).toEqual([1, 2, 3]); expect(host.childNodes).toHaveLength(0);
  expect(registeredIds().filter(id => id.startsWith('dispose-errors/'))).toEqual([]);
  region.dispose(); expect(calls).toHaveLength(3);
});

it('retains the ordinary cleanup contract when row ID tracking is disabled', () => {
  const host = document.createElement('ul'); const calls: number[] = [];
  const region = createListRegion(host, 'dispose-errors/untracked', (item: number, id) => {
    const node = document.createElement('li'); register({ id, parent: null, render() {} });
    return { nodes: node, entities: [id], dispose() { calls.push(item); } };
  }, undefined, false, false);
  region.reconcile([1, 2]); region.dispose();
  expect(calls).toEqual([1, 2]); expect(host.childNodes).toHaveLength(0);
  expect(registeredIds().filter(id => id.startsWith('dispose-errors/'))).toEqual([]);
});

it('keeps neighboring nodes and marker identity across DOM-only clear and replacement', () => {
  const host = document.createElement('ul');
  const before = document.createElement('p'); host.append(before);
  const region = createListRegion(host, 'dispose-errors/dom-only', (item: number) => {
    const a = document.createElement('li'); const b = document.createTextNode(String(item));
    return { nodes: [a, b], entities: [] };
  }, undefined, false, false, true);
  const open = host.childNodes[1]; const end = host.childNodes[2];
  const after = document.createElement('p'); host.append(after);
  region.reconcile([1, 2]); region.reconcile([]);
  expect([...host.childNodes]).toEqual([before, open, end, after]);
  region.reconcile([3, 4]); region.reconcile([5, 6]);
  expect(host.querySelectorAll('li')).toHaveLength(2); expect(host.textContent).toBe('56');
  region.dispose(); expect([...host.childNodes]).toEqual([before, after]);
});
