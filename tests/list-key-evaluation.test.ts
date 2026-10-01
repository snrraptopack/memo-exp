import { afterEach, expect, it } from 'vitest';
import { createListRegion } from '@memoized-dom/runtime/testing';

afterEach(() => { document.body.replaceChildren(); });

function create(items: { id: unknown; label: string }[], key = (item: typeof items[number]) => item.id) {
  const host = document.createElement('ul'); document.body.append(host);
  const disposed: unknown[] = [];
  const region = createListRegion(host, 'keys', initial => {
    let item = initial;
    const node = document.createElement('li'); node.textContent = item.label;
    return { nodes: node, entities: [],
      updateProps(next) { item = next as typeof initial; },
      update() { node.textContent = item.label; }, dispose() { disposed.push(initial); } };
  }, key, false);
  region.reconcile(items);
  return { host, region, disposed };
}

it('does not evaluate a removed suffix key, including an accessor that now throws', () => {
  let removed = false;
  const tail = { get id() { if (removed) throw new Error('removed key read'); return 3; }, label: 'three' };
  const items = [{ id: 1, label: 'one' }, { id: 2, label: 'two' }, tail];
  const app = create(items); const rows = [...app.host.children];
  removed = true;
  expect(() => app.region.reconcile(items.slice(0, 2))).not.toThrow();
  expect([...app.host.children]).toEqual(rows.slice(0, 2));
  expect(app.disposed).toEqual([tail]); expect(app.region.size()).toBe(2);
  app.region.dispose();
});

it('uses the first evaluated key when an append probe fails', () => {
  let probing = false, reads = 0;
  const first = { get id() { return probing ? 10 + ++reads : 1; }, label: 'first' };
  const app = create([first, { id: 2, label: 'second' }]);
  probing = true;
  app.region.reconcile([first, { id: 2, label: 'new second' }, { id: 3, label: 'third' }]);
  expect(reads).toBe(1);
  first.label = 'changed'; app.region.refreshKey(11);
  expect(app.host.firstElementChild!.textContent).toBe('changed');
  app.region.dispose();
});

it('evaluates each current key once when a removal probe encounters a reorder', () => {
  const items = [0,1,2,3].map(id => ({ id, label: String(id) }));
  const reads: unknown[] = [];
  const app = create(items, item => { reads.push(item.id); return item.id; });
  const rows = [...app.host.children]; reads.length = 0;
  app.region.reconcile([items[2]!, items[0]!]);
  expect(reads).toEqual([2,0]); expect([...app.host.children]).toEqual([rows[2], rows[0]]);
  app.region.dispose();
});

it('keeps SameValueZero key identity through content updates, append, removal and moves', () => {
  const object = {};
  const items = [NaN, -0, '0', object, Symbol('key')].map((id, index) => ({ id, label: String(index) }));
  const app = create(items); const rows = [...app.host.children];
  items[1]!.id = 0; items[0]!.label = 'nan'; app.region.reconcile(items);
  expect([...app.host.children]).toEqual(rows); expect(rows[0]!.textContent).toBe('nan');
  const extra = { id: 6, label: 'extra' };
  app.region.reconcile([...items, extra]);
  app.region.reconcile([items[4]!, items[0]!, items[1]!, items[3]!]);
  expect([...app.host.children]).toEqual([rows[4], rows[0], rows[1], rows[3]]);
  items[3]!.label = 'object'; app.region.refreshKey(object);
  expect(rows[3]!.textContent).toBe('object');
  app.region.dispose(); expect(app.host.children).toHaveLength(0);
});

it('rejects duplicate keys during a failed append/removal probe without extra key reads', () => {
  for (const next of [[1,2,2], [2,2]]) {
    const items = [1,2,3,4].slice(0, next.length === 3 ? 2 : 4).map(id => ({ id, label: String(id) }));
    const reads: unknown[] = [];
    const app = create(items, item => { reads.push(item.id); return item.id; }); reads.length = 0;
    expect(() => app.region.reconcile(next.map(id => ({ id, label: String(id) })))).toThrow('duplicate list key');
    expect(reads).toEqual(next); app.region.dispose();
  }
});

it.each(['append', 'truncate'] as const)('handles a key read that changes source length through %s', operation => {
  const items = [1,2,3].map(id => ({ id, label: String(id) }));
  let change = false;
  const reads: unknown[] = [];
  const app = create(items, item => {
    reads.push(item.id);
    if (change) {
      change = false;
      if (operation === 'append') items.push({ id: 4, label: '4' });
      else items.pop();
    }
    return item.id;
  });
  const rows = [...app.host.children]; reads.length = 0; change = true;
  app.region.reconcile(items);
  expect(reads).toEqual(operation === 'append' ? [1,2,3,4] : [1,2]);
  expect([...app.host.children].map(node => node.textContent)).toEqual(items.map(item => item.label));
  expect(app.host.children[0]).toBe(rows[0]); expect(app.host.children[1]).toBe(rows[1]);
  app.region.dispose();
});

it.each(['append', 'truncate'] as const)('handles source length changes while proving a removal through %s', operation => {
  const items = [1,2,3,4].map(id => ({ id, label: String(id) }));
  let current: typeof items | null = null;
  const reads: unknown[] = [];
  const app = create(items, item => {
    reads.push(item.id);
    if (current !== null && item.id === (operation === 'append' ? 2 : 3)) {
      if (operation === 'append') current.push(items[2]!, items[3]!);
      else current.length = 1;
      current = null;
    }
    return item.id;
  });
  const rows = [...app.host.children]; reads.length = 0;
  const next = operation === 'append' ? items.slice(0, 2) : items.slice(1, 3);
  current = next;
  app.region.reconcile(next);
  expect(reads).toEqual(operation === 'append' ? [1,2,3,4] : [2,3]);
  expect([...app.host.children]).toEqual(operation === 'append' ? rows : [rows[1]]);
  expect(app.region.size()).toBe(next.length);
  expect(app.disposed).toEqual(operation === 'append' ? [] : [items[0], items[2], items[3]]);
  app.region.dispose();
});

it('preserves key/update/disposal order and shifted bindings across removal gaps', () => {
  const symbol = Symbol('key'), object = {};
  const keys = [NaN, 0, '0', symbol, object, 'last'];
  const items = keys.map((id, index) => ({ id, label: String(index) }));
  const calls: string[] = [], nodes: Node[] = [];
  const host = document.createElement('div');
  const region = createListRegion(host, 'gaps', (initial, _id, initialIndex) => {
    const node = document.createElement('span'); nodes[initialIndex] = node;
    let item = initial, index = initialIndex;
    const render = () => { node.textContent = `${item.label}@${index}`; };
    render();
    return { nodes: node, entities: [],
      updateProps(value, position) { item = value as typeof initial; index = position; },
      update() { calls.push(`u${item.label}@${index}`); render(); },
      dispose() { calls.push(`d${initial.label}`); } };
  }, (item, index) => { calls.push(`k${item.label}@${index}`); return item.id; }, false, true);
  region.reconcile(items); calls.length = 0;
  const retained = [items[1]!, items[2]!, items[4]!];
  region.reconcile(retained);
  expect(calls).toEqual(['k1@0', 'k2@1', 'k4@2', 'u1@0', 'u2@1', 'u4@2', 'd0', 'd3', 'd5']);
  expect([...host.children]).toEqual([nodes[1], nodes[2], nodes[4]]);
  calls.length = 0; region.refreshKey(object);
  expect(calls).toEqual(['u4@2']); expect(nodes[4]!.textContent).toBe('4@2');
  region.dispose(); expect(host.children).toHaveLength(0);
});
