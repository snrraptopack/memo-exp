import { expect, it, vi } from 'vitest';
import { createListRegion } from '@memoized-dom/runtime';

it.each([1, 3, 8, 19])('validates all keys while avoiding repeated cache hashing for a shift of %i', offset => {
  const host = document.createElement('ul');
  const items = Array.from({ length: 20 }, (_, id) => ({ id, token: {}, label: String(id) }));
  const tokens = new Set(items.map(item => item.token));
  const calls: string[] = [];
  const region = createListRegion(host, 'cyclic-cache', (initial, _id, initialIndex) => {
    const node = document.createElement('li');
    let item = initial, index = initialIndex;
    node.textContent = item.label;
    return { nodes: node, entities: [],
      updateProps(next, position) { item = next as typeof initial; index = position; },
      update() { calls.push(`u${item.id}@${index}`); node.textContent = item.label; },
    };
  }, (item, index) => { calls.push(`k${item.id}@${index}`); return item.token; }, false, true);
  region.reconcile(items);
  const nodes = [...host.children];
  const observer = new MutationObserver(() => {});
  observer.observe(host, { childList: true });
  calls.length = 0;
  items.forEach(item => { item.label += '!'; });
  const next = items.slice(offset).concat(items.slice(0, offset));
  const get = vi.spyOn(Map.prototype, 'get');
  try {
    region.reconcile(next);
    // Authored key reads and content replay retain their forward interleaving.
    expect(calls).toEqual(next.flatMap((item, index) => [`k${item.id}@${index}`, `u${item.id}@${index}`]));
    const hashes = get.mock.calls.filter(([key]) => tokens.has(key)).length;
    expect(hashes).toBe(1);
    expect([...host.children]).toEqual(next.map(item => nodes[item.id]));
    next.forEach(item => expect(nodes[item.id]!.textContent).toBe(item.label));
    const moved = new Set<Node>();
    observer.takeRecords().forEach(record => record.addedNodes.forEach(node => moved.add(node)));
    expect(moved.size).toBe(Math.min(offset, items.length - offset));
  } finally {
    get.mockRestore(); observer.disconnect(); region.dispose();
  }
});

it('abandons a failed prediction and preserves general reorders and refresh positions', () => {
  const host = document.createElement('ul');
  const items = Array.from({ length: 8 }, (_, id) => ({ id }));
  const calls: string[] = [];
  const region = createListRegion(host, 'cyclic-fallback', (initial, _id, initialIndex) => {
    const node = document.createElement('li'); let item = initial, index = initialIndex;
    const render = () => { node.textContent = `${item.id}@${index}`; };
    render();
    return { nodes: node, entities: [],
      updateProps(next, position) { item = next as typeof initial; index = position; },
      update() { calls.push(`u${item.id}@${index}`); render(); },
    };
  }, item => item.id, false, true);
  region.reconcile(items);
  const nodes = [...host.children];
  for (const order of [[3, 4, 0, 6, 5, 2, 1, 7], [7, 6, 5, 4, 3, 2, 1, 0], [2, 3, 1, 4, 5, 6, 7, 0]]) {
    region.reconcile(order.map(id => items[id]!));
    expect([...host.children]).toEqual(order.map(id => nodes[id]));
    order.forEach((id, index) => expect(nodes[id]!.textContent).toBe(`${id}@${index}`));
    calls.length = 0;
    region.refreshKey(order[0]);
    expect(calls).toEqual([`u${order[0]}@0`]);
  }
  region.dispose();
});

it('retains duplicate detection after contiguous reuse and recovers through the general path', () => {
  const host = document.createElement('ul');
  const items = Array.from({ length: 5 }, (_, id) => ({ id }));
  const region = createListRegion(host, 'cyclic-duplicate', item => {
    const node = document.createElement('li'); node.textContent = String(item.id);
    return { nodes: node, entities: [] };
  }, item => item.id, false);
  region.reconcile(items);
  const nodes = [...host.children];
  expect(() => region.reconcile([items[3]!, items[4]!, items[0]!, items[0]!, items[1]!])).toThrow(/duplicate list key/);
  region.reconcile(items);
  expect([...host.children]).toEqual(nodes);
  region.dispose();
});

it('preserves SameValueZero key identity and immutable item replacements through cyclic reuse', () => {
  const host = document.createElement('ul');
  const keys = [NaN, -0, '0', {}, Symbol('row')];
  const items = keys.map((key, id) => ({ key, label: String(id) }));
  const region = createListRegion(host, 'cyclic-identities', initial => {
    const node = document.createElement('li'); let item = initial;
    node.textContent = item.label;
    return { nodes: node, entities: [],
      updateProps(next) { item = next as typeof initial; },
      update() { node.textContent = item.label; },
    };
  }, item => item.key, false, false);
  region.reconcile(items);
  const nodes = [...host.children];
  const replacements = items.map((item, id) => ({ key: id === 1 ? 0 : item.key, label: item.label + '!' }));
  const next = replacements.slice(3).concat(replacements.slice(0, 3));
  region.reconcile(next, true);
  expect([...host.children]).toEqual([nodes[3], nodes[4], nodes[0], nodes[1], nodes[2]]);
  nodes.forEach((node, id) => expect(node.textContent).toBe(`${id}!`));
  next[3]!.label = 'zero'; region.refreshKey(-0);
  expect(nodes[1]!.textContent).toBe('zero');
  next[2]!.label = 'nan'; region.refreshKey(NaN);
  expect(nodes[0]!.textContent).toBe('nan');
  region.dispose();
});

it('reads later keys after earlier row effects even when a prediction must create a new row', () => {
  const host = document.createElement('ul');
  const items = Array.from({ length: 4 }, (_, id) => ({ id }));
  const calls: string[] = [];
  let change = false;
  const region = createListRegion(host, 'cyclic-key-effects', initial => {
    calls.push(`c${initial.id}`);
    const node = document.createElement('li'); node.textContent = String(initial.id);
    let item = initial;
    return { nodes: node, entities: [],
      updateProps(next) { item = next as typeof initial; },
      update() { calls.push(`u${item.id}`); if (change && item.id === 2) items[3]!.id = 30; },
      dispose() { calls.push(`d${node.textContent}`); },
    };
  }, item => { calls.push(`k${item.id}`); return item.id; }, false);
  region.reconcile(items);
  const nodes = [...host.children]; calls.length = 0; change = true;
  region.reconcile(items.slice(2).concat(items.slice(0, 2)));
  expect(calls).toEqual(['k2', 'u2', 'k30', 'c30', 'k0', 'u0', 'k1', 'u1', 'd3']);
  expect([...host.children].map(node => node.textContent)).toEqual(['2', '30', '0', '1']);
  expect(host.children[0]).toBe(nodes[2]); expect(host.children[1]).not.toBe(nodes[3]);
  expect(host.children[2]).toBe(nodes[0]); expect(host.children[3]).toBe(nodes[1]);
  region.dispose();
});
