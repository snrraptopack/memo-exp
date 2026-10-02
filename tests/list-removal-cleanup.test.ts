import { afterEach, expect, it } from 'vitest';
import { cleanup, createListRegion, register, registeredIds, unregister } from '@memoized-dom/runtime/testing';

afterEach(() => {
  for (const id of registeredIds()) if (id.startsWith('removal-cleanup/')) {
    try { unregister(id); } catch {}
  }
  document.body.replaceChildren();
});

const shapes = [
  ['suffix', [1,2,3,4], [1,2], 3],
  ['subsequence', [1,2,3,4], [2,4], 1],
  ['mixed', [1,2,3,4], [4,5,2], 1],
  ['replacement', [1,2,3], [4,5], 1],
  ['clear', [1,2,3], [], 1],
] as const;

function setup(onDispose: (item: number) => void, onEntity: (item: number) => void = () => {}) {
  const host = document.createElement('ul'); document.body.append(host);
  const disposers: number[] = [], entities: number[] = [], created: number[] = [];
  const region = createListRegion(host, 'removal-cleanup/list', (item: number, id) => {
    created.push(item); const node = document.createElement('li'); node.textContent = String(item);
    register({id, parent:null, render(){}});
    cleanup(id, () => { entities.push(item); onEntity(item); });
    return {nodes:node, entities:[id], dispose() { disposers.push(item); onDispose(item); }};
  });
  return {host, region, disposers, entities, created};
}

for (const [name, initial, next, target] of shapes) {
  it.each(['disposer', 'entity'] as const)(`${name}: cancels removal after a %s unmounts`, phase => {
    let active = false;
    const callback = (item: number) => { if (active && item === target) app.region.dispose(); };
    const app = setup(phase === 'disposer' ? callback : () => {}, phase === 'entity' ? callback : () => {});
    app.region.reconcile(initial); active = true;
    expect(() => app.region.reconcile(next)).not.toThrow();
    expect([...app.disposers].sort()).toEqual([...app.created].sort());
    expect([...app.entities].sort()).toEqual([...app.created].sort());
    expect(app.host.childNodes).toHaveLength(0); expect(app.region.size()).toBe(0);
    expect(registeredIds().filter(id => id.startsWith('removal-cleanup/'))).toEqual([]);
    app.region.dispose(); expect(app.disposers).toHaveLength(app.created.length);
  });

  it.each(['disposer', 'entity'] as const)(`${name}: finishes removal and reports one %s error unchanged`, phase => {
    const failure = new Error(`${name}/${phase}`); let active = false;
    const callback = (item: number) => { if (active && item === target) throw failure; };
    const app = setup(phase === 'disposer' ? callback : () => {}, phase === 'entity' ? callback : () => {});
    app.region.reconcile(initial);
    const oldRows = [...app.host.children]; active = true;
    let caught: unknown;
    try { app.region.reconcile(next); } catch (error) { caught = error; }
    expect(caught).toBe(failure);
    const removed = initial.filter(item => !(next as readonly number[]).includes(item));
    expect(app.disposers).toEqual(removed); expect(app.entities).toEqual(removed);
    for (const item of removed) expect(oldRows[initial.indexOf(item)]!.parentNode).toBe(null);
    active = false;
    app.region.dispose(); app.region.dispose();
    expect([...app.disposers].sort()).toEqual([...app.created].sort());
    expect([...app.entities].sort()).toEqual([...app.created].sort());
    expect(app.host.childNodes).toHaveLength(0);
    expect(registeredIds().filter(id => id.startsWith('removal-cleanup/'))).toEqual([]);
  });

  it(`${name}: reports a failure after reentrant unmount without repeating ownership cleanup`, () => {
    let active = false; const failure = new Error('after unmount');
    const app = setup(item => {
      if (active && item === target) { app.region.dispose(); throw failure; }
    });
    app.region.reconcile(initial); active = true;
    let caught: unknown;
    try { app.region.reconcile(next); } catch (error) { caught = error; }
    expect(caught).toBe(failure);
    expect([...app.disposers].sort()).toEqual([...app.created].sort());
    expect([...app.entities].sort()).toEqual([...app.created].sort());
    expect(app.host.childNodes).toHaveLength(0); expect(app.region.size()).toBe(0);
  });
}

it('collects failures from several removed rows before reporting them', () => {
  const first = new Error('first'), last = new Error('last'); let active = false;
  const app = setup(item => { if (active && item === 1) throw first; }, item => { if (active && item === 3) throw last; });
  app.region.reconcile([1,2,3,4]); active = true;
  let caught: unknown;
  try { app.region.reconcile([4,5]); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(AggregateError);
  expect((caught as AggregateError).errors).toEqual([first, last]);
  expect(app.disposers).toEqual([1,2,3]); expect(app.entities).toEqual([1,2,3]);
  active = false; app.region.dispose();
  expect([...app.disposers].sort()).toEqual([1,2,3,4,5]);
  expect(app.host.childNodes).toHaveLength(0);
});

it.each(['suffix', 'subsequence'] as const)('%s: keeps survivors usable after a removal error', shape => {
  let active = false; const failure = new Error('removal');
  const app = setup(item => { if (active && item === 3) throw failure; });
  app.region.reconcile([1,2,3,4]); const nodes = [...app.host.children]; active = true;
  const next = shape === 'suffix' ? [1,2] : [2,4];
  expect(() => app.region.reconcile(next)).toThrow(failure); active = false;
  expect(app.region.size()).toBe(2);
  expect([...app.host.children]).toEqual(next.map(item => nodes[item - 1]));
  app.region.reconcile([...next, 5]);
  expect([...app.host.children].map(row => row.textContent)).toEqual([...next,5].map(String));
  expect(app.disposers).toEqual(shape === 'suffix' ? [3,4] : [1,3]);
  app.region.dispose(); expect([...app.disposers].sort()).toEqual([1,2,3,4,5]);
});

it.each([false, true])('finishes individual removals after range deletion throws (replacement=%s)', replacement => {
  const app = setup(() => {}); app.region.reconcile([1,2,3]);
  const failure = new Error('range'); const original = document.createRange;
  document.createRange = () => { throw failure; };
  try { expect(() => app.region.reconcile(replacement ? [4,5] : [1])).toThrow(failure); }
  finally { document.createRange = original; }
  expect(app.disposers).toEqual(replacement ? [1,2,3] : [2,3]);
  expect(app.entities).toEqual(app.disposers);
  app.region.dispose();
  expect([...app.disposers].sort()).toEqual([...app.created].sort());
  expect(app.host.childNodes).toHaveLength(0);
});

it.each([false, true])('DOM-only suffix removal keeps markers, neighbors and multi-node ownership (range=%s)', rangeAvailable => {
  const host = document.createElement('div'); document.body.append(host);
  const before = document.createTextNode('before'), after = document.createTextNode('after'); host.append(before);
  const original = document.createRange;
  if (!rangeAvailable) document.createRange = undefined as unknown as typeof original;
  try {
    const region = createListRegion(host, 'removal-cleanup/plain', (item: number) => {
      if (item === 2) return {nodes:[], entities:[]};
      const first = document.createElement('b'), second = document.createElement('i');
      first.textContent = String(item); second.textContent = String(item);
      return {nodes:[first,second], entities:[]};
    }, undefined, false, false, true);
    host.append(after); region.reconcile([1,2,3,4]);
    const nodes = [...host.childNodes], markers = nodes.filter(node => node.nodeType === 8);
    region.reconcile([1]);
    expect([...host.childNodes]).toEqual([before,markers[0],nodes[2],nodes[3],markers[1],after]);
    region.reconcile([1,5]); expect(region.size()).toBe(2);
    region.dispose(); expect([...host.childNodes]).toEqual([before,after]);
  } finally { document.createRange = original; }
});
