import { afterEach, expect, it } from 'vitest';
import { createListRegion } from '@memoized-dom/runtime/testing';

afterEach(() => { document.body.innerHTML = ''; });

it('retains input state, listeners and ownership when moving one single-node row', () => {
  const host = document.createElement('div'); document.body.append(host);
  const items = [0, 1, 2, 3];
  const inputs: HTMLInputElement[] = [];
  const clicks: number[] = [], disposed: number[] = [];
  const region = createListRegion(host, 'single-input', id => {
    const input = document.createElement('input'); inputs[id] = input;
    input.value = String(id); input.addEventListener('click', () => clicks.push(id));
    return { nodes: input, entities: [], dispose() { disposed.push(id); } };
  }, id => id, false);
  region.reconcile(items); inputs[0]!.value = 'edited';
  region.reconcile([1, 2, 0, 3]);
  expect([...host.children]).toEqual([inputs[1], inputs[2], inputs[0], inputs[3]]);
  expect(inputs[0]!.value).toBe('edited');
  inputs[0]!.click(); expect(clicks).toEqual([0]); expect(disposed).toEqual([]);
  region.dispose(); expect(disposed.sort()).toEqual(items); expect(host.children).toHaveLength(0);
});

it('preserves array iteration when a one-element array row moves alone', () => {
  const host = document.createElement('div');
  const nodes: Node[] = [], iterations: number[] = [];
  const region = createListRegion(host, 'array-iteration', id => {
    const node = document.createElement('span'); nodes[id] = node;
    const extent = [node];
    extent[Symbol.iterator] = function* () { iterations.push(id); yield node; };
    return { nodes: extent, entities: [] };
  }, (id: number) => id, false);
  region.reconcile([0, 1, 2, 3]); iterations.length = 0;
  region.reconcile([1, 2, 0, 3]);
  expect([...host.children]).toEqual([nodes[1], nodes[2], nodes[0], nodes[3]]);
  expect(iterations).toEqual([0]);
  region.dispose();
});

// Independent quadratic oracle: minimum retained rows that must move.
function minimumMoves(previous: number[], next: number[]): number {
  const positions = next.map(id => previous.indexOf(id)).filter(index => index >= 0);
  const lengths = positions.map(() => 1);
  let longest = 0;
  for (let i = 0; i < positions.length; i++) {
    for (let j = 0; j < i; j++) {
      if (positions[j]! < positions[i]!) lengths[i] = Math.max(lengths[i]!, lengths[j]! + 1);
    }
    longest = Math.max(longest, lengths[i]!);
  }
  return positions.length - longest;
}
function* permutations(values: number[]): Generator<number[]> {
  if (values.length === 0) { yield []; return; }
  for (let i = 0; i < values.length; i++) {
    for (const tail of permutations(values.filter((_, index) => index !== i))) {
      yield [values[i]!, ...tail];
    }
  }
}

it('preserves identity and the minimum move count through every six-row permutation', () => {
  const host = document.createElement('ul'); document.body.append(host);
  const records = Array.from({ length: 6 }, (_, id) => ({ id }));
  const nodes = new Map<number, Node>();
  const region = createListRegion(host, 'permutations', item => {
    const node = document.createElement('li'); node.textContent = String(item.id);
    nodes.set(item.id, node); return { nodes: node, entities: [] };
  }, item => item.id, false);
  region.reconcile(records);
  const observer = new MutationObserver(() => {}); observer.observe(host, { childList: true });
  let previous = records.map(item => item.id);
  for (const order of permutations(previous)) {
    region.reconcile(order.map(id => records[id]!));
    host.querySelectorAll('li').forEach((node, index) => expect(node).toBe(nodes.get(order[index]!)));
    const moves = observer.takeRecords().reduce((count, record) => count + record.addedNodes.length, 0);
    expect(moves).toBe(minimumMoves(previous, order));
    previous = order;
  }
  observer.disconnect(); region.dispose();
});

it('keeps key/update evaluation order and refreshes all content during a sparse swap', () => {
  const host = document.createElement('ul');
  const items = Array.from({ length: 1000 }, (_, id) => ({ id, label: String(id) }));
  const calls: string[] = [];
  const region = createListRegion(host, 'sparse', (initial, _id, initialIndex) => {
    const node = document.createElement('li'); let item = initial, index = initialIndex;
    node.textContent = item.label;
    return { nodes: node, entities: [],
      updateProps(value, position) { item = value as typeof initial; index = position; },
      update() { calls.push(`u${item.id}@${index}`); node.textContent = item.label; },
    };
  }, (item, index) => { calls.push(`k${item.id}@${index}`); return item.id; }, false);
  region.reconcile(items); const nodes = Array.from(host.querySelectorAll('li')); calls.length = 0;
  for (const item of items) item.label += '!';
  [items[1], items[998]] = [items[998]!, items[1]!];
  region.reconcile(items);
  expect(calls).toEqual(items.flatMap((item, index) => [`k${item.id}@${index}`, `u${item.id}@${index}`]));
  host.querySelectorAll('li').forEach((node, index) => {
    expect(node).toBe(nodes[items[index]!.id]); expect(node.textContent).toBe(items[index]!.label);
  });
  calls.length = 0; region.refreshKey(998);
  expect(calls).toEqual(['u998@1']);
  region.dispose();
});

it('moves multi-node rows between stable boundaries and refreshes changed indices', () => {
  const host = document.createElement('div');
  const before = document.createElement('aside'); host.append(before);
  const updated: number[] = [];
  const items = Array.from({ length: 20 }, (_, id) => ({ id }));
  const region = createListRegion(host, 'fragments', (initial, _id, initialIndex) => {
    const nodes = [document.createElement('span'), document.createElement('b')];
    let item = initial, index = initialIndex;
    const render = () => { nodes[0]!.textContent = `${item.id}@${index}`; nodes[1]!.textContent = String(item.id); };
    render();
    return { nodes, entities: [], updateProps(value, position) { item = value as typeof initial; index = position; },
      update() { updated.push(item.id); render(); } };
  }, item => item.id, false, true);
  region.reconcile(items);
  const after = document.createElement('aside'); host.append(after);
  const spans = Array.from(host.querySelectorAll('span'));
  [items[3], items[7]] = [items[7]!, items[3]!];
  region.reconcile(items, true);
  expect(updated).toEqual([7, 3]);
  host.querySelectorAll('span').forEach((node, index) => {
    expect(node).toBe(spans[items[index]!.id]); expect(node.textContent).toBe(`${items[index]!.id}@${index}`);
    expect(node.nextSibling!.textContent).toBe(String(items[index]!.id));
  });
  expect(host.firstChild).toBe(before); expect(host.lastChild).toBe(after);
  updated.length = 0; region.refreshKey(7); expect(updated).toEqual([7]);
  region.dispose(); expect(Array.from(host.children)).toEqual([before, after]);
});

it('handles additions, removals, replacement objects and shifted stable suffixes', () => {
  const host = document.createElement('ul');
  const live = new Map<number, Node>(); const disposed: number[] = [];
  const region = createListRegion(host, 'mixed', (initial, _id, initialIndex) => {
    const node = document.createElement('li'); let item = initial, index = initialIndex;
    node.textContent = `${item.id}@${index}:${item.label}`; live.set(item.id, node);
    return { nodes: node, entities: [], updateProps(value, position) { item = value as typeof initial; index = position; },
      update() { node.textContent = `${item.id}@${index}:${item.label}`; }, dispose() { disposed.push(item.id); } };
  }, (item: { id: number; label: string }) => item.id, false);
  const observer = new MutationObserver(() => {}); observer.observe(host, { childList: true });
  const orders = [[0,1,2,3,4,5,6,7], [0,3,2,1,4,5,6,7], [0,3,8,1,4,5,6,7],
    [0,1,8,9,4,5,6,7], [0,1,9,4,5,6,7], [0,10,1,9,4,5,6,7], [7,6,5,4,9,1,10,0],
    [0,1,4,5,6,7], [0,1,11,12,4,5,6,7], [], [20,21,22], [21,20,22]];
  let previous: number[] = [];
  for (const [step, order] of orders.entries()) {
    const previousNodes = new Map(live); disposed.length = 0;
    region.reconcile(order.map(id => ({ id, label: `step ${step}` })));
    const moved = new Set<Node>();
    for (const record of observer.takeRecords()) {
      record.addedNodes.forEach(node => { if ([...previousNodes.values()].includes(node)) moved.add(node); });
    }
    expect(moved.size).toBe(minimumMoves(previous, order));
    expect(disposed.sort((a,b) => a-b)).toEqual(previous.filter(id => !order.includes(id)).sort((a,b) => a-b));
    expect(host.querySelectorAll('li')).toHaveLength(order.length);
    host.querySelectorAll('li').forEach((node, index) => {
      const id = order[index]!;
      if (previous.includes(id)) expect(node).toBe(previousNodes.get(id));
      expect(node.textContent).toBe(`${id}@${index}:step ${step}`);
    });
    for (const id of disposed) live.delete(id);
    previous = order;
  }
  observer.disconnect(); region.dispose();
});

it.each([1, 3, 4, 7])('minimizes moves for an inner cyclic shift of %i multi-node rows', offset => {
  const host = document.createElement('div'); document.body.append(host);
  const items = Array.from({ length: 10 }, (_, id) => ({ id }));
  const nodes = new Map<number, Node[]>();
  const calls: string[] = [];
  const region = createListRegion(host, 'cycles', (initial, _id, initialIndex) => {
    const pair = [document.createElement('span'), document.createElement('b')];
    nodes.set(initial.id, pair);
    let item = initial, index = initialIndex;
    const render = () => { pair[0]!.textContent = `${item.id}@${index}`; };
    render();
    return { nodes: pair, entities: [],
      updateProps(next, position) { item = next as typeof initial; index = position; },
      update() { calls.push(`u${item.id}@${index}`); render(); } };
  }, (item, index) => { calls.push(`k${item.id}@${index}`); return item.id; }, false, true);
  region.reconcile(items); calls.length = 0;
  const observer = new MutationObserver(() => {}); observer.observe(host, { childList: true });
  const middle = items.slice(1, 9);
  const next = [items[0]!, ...middle.slice(offset), ...middle.slice(0, offset), items[9]!];
  region.reconcile(next);
  expect(calls).toEqual(next.flatMap((item, index) => [`k${item.id}@${index}`, `u${item.id}@${index}`]));
  const moved = new Set<Node>();
  for (const record of observer.takeRecords()) record.addedNodes.forEach(node => moved.add(node));
  expect(moved.size).toBe(2 * Math.min(offset, 8 - offset));
  // Ties keep the smaller old positions, as the general LIS does.
  const movedItems = offset < 4 ? middle.slice(0, offset) : middle.slice(offset);
  expect(moved).toEqual(new Set(movedItems.flatMap(item => nodes.get(item.id)!)));
  expect([...host.children]).toEqual(next.flatMap(item => nodes.get(item.id)!));
  next.forEach((item, index) => expect(nodes.get(item.id)![0]!.textContent).toBe(`${item.id}@${index}`));
  observer.disconnect(); region.dispose();
});
