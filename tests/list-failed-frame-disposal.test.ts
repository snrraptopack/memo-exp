import { afterEach, expect, it } from 'bun:test';
import { createListRegion, register, registeredIds, unregister } from '@memoized-dom/runtime/testing';

afterEach(() => {
  for (const id of registeredIds()) if (id.startsWith('failed-frames-')) unregister(id);
  document.body.replaceChildren();
});

let nextPrefix = 0;

function create(failFactory?: number) {
  const host = document.createElement('ul'); document.body.append(host);
  const disposed: number[] = [];
  const prefix = `failed-frames-${++nextPrefix}`;
  const region = createListRegion(host, prefix, (initial, id) => {
    if (initial.id === failFactory) throw new Error('factory');
    const node = document.createElement('li'); node.textContent = initial.label;
    register({id, parent: null, render: () => {}});
    let item = initial;
    return {nodes: node, entities: [id], update(next) { item = next as typeof initial;  node.textContent = item.label; },
       dispose() { disposed.push(initial.id); }};
  }, (item: {id: number; label: string}) => item.id);
  const items = [1,2,3].map(id => ({id, label: String(id)}));
  region.reconcile(items);
  return {host, region, items, disposed, ids: () => registeredIds().filter(id => id.startsWith(prefix + '/'))};
}

it('disposes consumed retained rows after a duplicate-key failure', () => {
  const app = create();
  expect(() => app.region.reconcile([{id: 1, label: 'updated'}, {id: 1, label: 'duplicate'},
    {id: 3, label: 'three'}])).toThrow('duplicate list key');
  expect(app.host.firstElementChild!.textContent).toBe('updated');
  app.region.dispose();
  expect(app.host.childNodes).toHaveLength(0); expect(app.ids()).toEqual([]);
  expect(app.disposed.sort()).toEqual([1,2,3]);
  app.region.dispose(); expect(app.disposed).toHaveLength(3);
});

it('disposes retained and newly created rows after a later general-path key throws', () => {
  const app = create();
  expect(() => app.region.reconcile([{id: 1, label: 'updated'}, {id: 4, label: 'four'},
    {get id() { throw new Error('key'); }, label: 'bad'}])).toThrow('key');
  app.region.dispose();
  expect(app.host.childNodes).toHaveLength(0); expect(app.ids()).toEqual([]);
  expect(app.disposed.sort()).toEqual([1,2,3,4]);
});

it('disposes completed detached append rows when a later factory throws', () => {
  const app = create(5);
  expect(() => app.region.reconcile([...app.items, {id: 4, label: 'four'}, {id: 5, label: 'bad'}])).toThrow('factory');
  expect(app.host.querySelectorAll('li')).toHaveLength(3);
  app.region.dispose();
  expect(app.host.childNodes).toHaveLength(0); expect(app.ids()).toEqual([]);
  expect(app.disposed.sort()).toEqual([1,2,3,4]);
});

it('does not dispose removal-probe records twice after a later key throws', () => {
  const app = create();
  expect(() => app.region.reconcile([app.items[0]!,
    {get id() { throw new Error('key'); }, label: 'bad'}])).toThrow('key');
  app.region.dispose();
  expect(app.host.childNodes).toHaveLength(0); expect(app.ids()).toEqual([]);
  expect(app.disposed.sort()).toEqual([1,2,3]);
});
