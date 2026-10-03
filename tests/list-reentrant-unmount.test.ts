import { afterEach, expect, it } from 'vitest';
import { createListRegion, register, registeredIds, unregisterSubtree } from '@memoized-dom/runtime/testing';

afterEach(() => {
  for (const id of registeredIds()) if (id.startsWith('reentrant-unmount/')) unregisterSubtree(id);
  document.body.replaceChildren();
});

function create() {
  const host = document.createElement('ul'); document.body.append(host);
  const created: number[] = [], updated: number[] = [], cleaned: number[] = [];
  let onKey = (_item: number) => {}, onCreate = (_item: number) => {}, onUpdate = (_item: number) => {}, onProps = (_item: number) => {};
  const region = createListRegion(host, 'reentrant-unmount/list', (item: number, id) => {
    created.push(item); const node = document.createElement('li'); node.textContent = String(item);
    register({id, parent:null, render() {}}); onCreate(item);
    return { nodes:node, entities:[id], update(next) { onProps(next as number); if (!registeredIds().includes(id)) return; updated.push(item); onUpdate(item); },
      dispose() { cleaned.push(item); } };
  }, item => { onKey(item); return item; });
  return {host, region, created, updated, cleaned,
    hooks(key = onKey, factory = onCreate, update = onUpdate, props = onProps) { onKey=key; onCreate=factory; onUpdate=update; onProps=props; }};
}

it.each([
  ['fresh', [], [1,2,3]],
  ['append', [1], [1,2,3]],
  ['replacement', [1,2], [3,4]],
])('%s: cleans the entry returned after its factory unmounts the region', (_name, initial, next) => {
  const app = create(); app.region.reconcile(initial as number[]);
  const target = (next as number[]).find(item => !(initial as number[]).includes(item))!;
  app.hooks(undefined, item => { if (item === target) app.region.dispose(); });
  expect(() => app.region.reconcile(next as number[])).not.toThrow();
  expect(app.created).toEqual([...(initial as number[]), target]);
  expect(app.cleaned.sort()).toEqual([...app.created].sort());
  expect(app.host.childNodes).toHaveLength(0); expect(app.region.size()).toBe(0);
  expect(registeredIds().filter(id => id.startsWith('reentrant-unmount/'))).toEqual([]);
});

it('does not render after a retained prop replay unmounts its owner', () => {
  const app = create(); app.region.reconcile([1,2]);
  app.hooks(undefined, undefined, undefined, () => app.region.dispose());
  app.region.reconcile([1,2]);
  expect(app.updated).toEqual([]); expect(app.cleaned).toEqual([1,2]);
  expect(app.host.childNodes).toHaveLength(0);
});

it('stops an index refresh after the first updater unmounts', () => {
  const app = create(); app.region.reconcile([1,2]);
  app.hooks(undefined, undefined, () => app.region.dispose());
  app.region.refreshIndices([1,2], [0,1], true);
  expect(app.updated).toEqual([1]); expect(app.cleaned).toEqual([1,2]);
  expect(app.host.childNodes).toHaveLength(0);
});

it('cleans a late factory entry even if its disposer throws', () => {
  const host = document.createElement('ul'); const error = new Error('late cleanup');
  const region = createListRegion(host, 'reentrant-unmount/late', (_item: number, id) => {
    const node = document.createElement('li'); register({id, parent:null, render(){}});
    region.dispose();
    return {nodes:node, entities:[id], dispose(){throw error;}};
  });
  expect(() => region.reconcile([1,2])).toThrow(error);
  expect(host.childNodes).toHaveLength(0); expect(region.size()).toBe(0);
  expect(registeredIds().filter(id => id.startsWith('reentrant-unmount/'))).toEqual([]);
});

it.each([
  ['fresh', [], [1,2]],
  ['steady', [1,2], [1,2]],
  ['append prefix', [1,2], [1,2,3]],
  ['append tail', [1,2], [1,2,3], 3],
  ['removal', [1,2,3], [1,2]],
  ['mixed', [1,2], [3,1,2]],
])('%s: stops immediately when a key getter unmounts', (_name, initial, next, target) => {
  const app = create(); app.region.reconcile(initial as number[]); const reads: number[] = [];
  app.hooks(item => { reads.push(item); if (item === (target ?? (next as number[])[0])) app.region.dispose(); });
  expect(() => app.region.reconcile(next as number[])).not.toThrow();
  expect(reads.at(-1)).toBe(target ?? (next as number[])[0]);
  expect(app.created).toEqual(initial); expect(app.cleaned.sort()).toEqual([...(initial as number[])].sort());
  expect(app.host.childNodes).toHaveLength(0); expect(app.region.size()).toBe(0);
});

it.each([
  ['steady', [1,2]], ['append', [1,2,3]], ['removal', [1]], ['mixed', [3,1,2]],
])('%s: stops mounting/updating later rows after a retained update unmounts', (_name, next) => {
  const app = create(); app.region.reconcile([1,2]);
  app.hooks(undefined, undefined, () => app.region.dispose());
  expect(() => app.region.reconcile(next as number[])).not.toThrow();
  expect(app.updated).toEqual([1]);
  expect(app.cleaned.sort()).toEqual([...app.created].sort());
  expect(app.host.childNodes).toHaveLength(0); expect(app.region.size()).toBe(0);
  expect(registeredIds().filter(id => id.startsWith('reentrant-unmount/'))).toEqual([]);
});
