import { afterEach, expect, it } from 'bun:test';
import { createListRegion } from '@memoized-dom/runtime/testing';

afterEach(() => { document.body.replaceChildren(); });

function setup(pair = false) {
  const host = document.createElement('div'); document.body.append(host);
  const before = document.createElement('aside'); host.append(before);
  const nodes = new Map<number, Node[]>(), disposed: number[] = [], calls: string[] = [];
  const region = createListRegion(host, 'empty-placement', (id: number) => {
    const extent = id % 2 ? [] : [document.createElement('input')];
    if (pair && extent.length) extent.push(document.createElement('input'));
    for (const node of extent) node.value = String(id);
    nodes.set(id, extent);
    return { nodes: extent, entities: [], update() { calls.push(`u${id}`); },
      dispose() { disposed.push(id); } };
  }, id => { calls.push(`k${id}`); return id; }, false);
  region.reconcile([0, 1, 2, 3, 4]);
  const open = before.nextSibling!, close = host.lastChild!;
  const after = document.createElement('aside'); host.append(after);
  nodes.get(0)![0]!.textContent = 'retained';
  calls.length = 0;
  function check(order: number[]) {
    expect([...host.querySelectorAll('input')].map(node => node.value), `order ${order}`).toEqual(
      order.flatMap(id => nodes.get(id)!).map(node => (node as HTMLInputElement).value));
    expect([...host.childNodes]).toEqual([before, open, ...order.flatMap(id => nodes.get(id)!), close, after]);
    expect(region.size()).toBe(order.length);
    expect(nodes.get(0)![0]!.textContent).toBe('retained');
  }
  return { host, before, after, region, nodes, disposed, calls, check };
}

for (const pair of [false, true]) {
  it.each([
    ['cyclic prefix move', [4, 0, 1, 2, 3]],
    ['cyclic suffix move', [1, 2, 3, 4, 0]],
    ['empty LIS row', [0, 2, 1, 3, 4]],
    ['empty first suffix row', [2, 1, 0, 3, 4]],
    ['empty trailing suffix', [4, 0, 2, 1, 3]],
  ] as const)(`places ${pair ? 'multi-node' : 'single-node'} rows before the boundary with %s`, (_name, order) => {
    const app = setup(pair);
    try {
      app.region.reconcile(order);
      app.check([...order]);
      expect(app.calls).toEqual(order.flatMap(id => [`k${id}`, `u${id}`]));
      expect(app.disposed).toEqual([]);
      app.calls.length = 0; app.region.refreshKey(1);
      expect(app.calls).toEqual(['u1']);
    } finally { app.region.dispose(); }
    expect(app.disposed.sort()).toEqual([0, 1, 2, 3, 4]);
    expect([...app.host.childNodes]).toEqual([app.before, app.after]);
  });
}

it.each([1, 4])('keeps cyclic placement boundaries when the first retained extent is empty (offset=%i)', offset => {
  const app = setup(true);
  try {
    const previous = [1, 2, 3, 4, 0];
    app.region.reconcile(previous);
    const next = previous.slice(offset).concat(previous.slice(0, offset));
    app.calls.length = 0;
    app.region.reconcile(next);
    app.check(next);
    expect(app.calls).toEqual(next.flatMap(id => [`k${id}`, `u${id}`]));
    expect(app.disposed).toEqual([]);
    app.calls.length = 0;
    app.region.refreshKey(next[0]);
    expect(app.calls).toEqual([`u${next[0]}`]);
  } finally { app.region.dispose(); }
  expect(app.disposed.sort()).toEqual([0, 1, 2, 3, 4]);
  expect([...app.host.childNodes]).toEqual([app.before, app.after]);
});

function* permutations(values: number[]): Generator<number[]> {
  if (!values.length) { yield []; return; }
  for (let i = 0; i < values.length; i++) {
    for (const tail of permutations(values.filter((_, index) => index !== i))) yield [values[i]!, ...tail];
  }
}

it('retains row extents and stable boundaries through every permutation with empty rows', () => {
  const app = setup(true);
  try {
    for (const order of permutations([0, 1, 2, 3, 4])) {
      app.region.reconcile(order); app.check(order);
      expect(app.disposed).toEqual([]);
    }
    // Continue with a new empty row, a new visible row and retained empty rows.
    app.region.reconcile([5, 3, 6, 0, 1]); app.check([5, 3, 6, 0, 1]);
    expect(app.disposed.sort()).toEqual([2, 4]);
    app.region.reconcile([3, 1]);
    expect([...app.host.children]).toEqual([app.before, app.after]);
    app.calls.length = 0; app.region.refreshKey(3); expect(app.calls).toEqual(['u3']);
  } finally { app.region.dispose(); }
  expect(app.disposed.sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
  expect([...app.host.childNodes]).toEqual([app.before, app.after]);
});
