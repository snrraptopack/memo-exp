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
