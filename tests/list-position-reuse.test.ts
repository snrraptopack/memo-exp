import { afterEach, expect, it } from 'vitest';
import { createListRegion } from '@memoized-dom/runtime/testing';

afterEach(() => { document.body.replaceChildren(); });

it.each([false, true])('keeps interleaved key/update effects for replacement objects (tracked=%s)', tracked => {
  const host = document.createElement('ul'); document.body.append(host);
  const calls: string[] = [];
  let changed = false;
  const region = createListRegion(host, 'effects', initial => {
    calls.push(`c:${initial.label}`);
    const node = document.createElement('li'); node.textContent = initial.label;
    let item = initial;
    return { nodes: node, entities: [],
      updateProps(next) { item = next as typeof initial; },
      update() {
        calls.push(`u:${item.label}`);
        if (item.label === 'one!') changed = true;
        node.textContent = item.label;
      }, dispose() { calls.push(`d:${item.label}`); } };
  }, (item: { id: number; label: string }) => { calls.push(`k:${item.id}`); return item.id; }, tracked);
  region.reconcile([{id: 1, label: 'one'}, {id: 2, label: 'two'}, {id: 3, label: 'three'}]);
  const original = [...host.children]; calls.length = 0;
  region.reconcile([{id: 1, label: 'one!'},
    {get id() { return changed ? 20 : 2; }, label: 'two!'}, {id: 3, label: 'three!'}]);
  expect(calls).toEqual(['k:1', 'u:one!', 'k:20', 'c:two!', 'k:3', 'u:three!', 'd:two']);
  expect([...host.children].map(node => node.textContent)).toEqual(['one!', 'two!', 'three!']);
  expect(host.children[0]).toBe(original[0]); expect(host.children[1]).not.toBe(original[1]);
  expect(host.children[2]).toBe(original[2]);
  region.dispose();
});

it('preserves SameValueZero identities for immutable content updates followed by a sparse swap', () => {
  const host = document.createElement('ul'); document.body.append(host);
  const keys = [NaN, -0, '0', {}, Symbol('row')];
  const region = createListRegion(host, 'immutable', initial => {
    const node = document.createElement('li'); node.textContent = initial.label;
    let item = initial;
    return { nodes: [node], entities: [], updateProps(next) { item = next as typeof initial; },
      update() { node.textContent = item.label; } };
  }, (item: { id: unknown; label: string }) => item.id, false);
  region.reconcile(keys.map((id, i) => ({id, label: String(i)})));
  const original = [...host.children];
  const next = keys.map((id, i) => ({id: i === 1 ? 0 : id, label: `${i}!`}));
  region.reconcile(next);
  expect([...host.children]).toEqual(original);
  expect([...host.children].map(node => node.textContent)).toEqual(next.map(item => item.label));
  [next[1], next[3]] = [next[3]!, next[1]!];
  region.reconcile(next);
  expect([...host.children]).toEqual([original[0], original[3], original[2], original[1], original[4]]);
  next[3]!.label = 'zero'; region.refreshKey(-0);
  expect(original[1]!.textContent).toBe('zero');
  region.dispose();
});

it('rejects a duplicate after a same-position prefix before reading or creating later rows', () => {
  const host = document.createElement('ul'); document.body.append(host);
  const calls: string[] = [];
  const region = createListRegion(host, 'duplicates', initial => {
    calls.push(`c:${initial.label}`);
    const node = document.createElement('li'); node.textContent = initial.label;
    let item = initial;
    return { nodes: node, entities: [], updateProps(next) { item = next as typeof initial; },
      update() { calls.push(`u:${item.label}`); node.textContent = item.label; } };
  }, (item: { id: number; label: string }) => { calls.push(`k:${item.id}`); return item.id; }, false);
  region.reconcile([1,2,3].map(id => ({id, label: String(id)}))); calls.length = 0;
  expect(() => region.reconcile([{id: 1, label: 'updated'}, {id: 1, label: 'duplicate'},
    {get id() { throw new Error('later key read'); }, label: 'later'}])).toThrow('duplicate list key');
  expect(calls).toEqual(['k:1', 'u:updated', 'k:1']);
  expect([...host.children].map(node => node.textContent)).toEqual(['updated', '2', '3']);
  region.dispose();
});
