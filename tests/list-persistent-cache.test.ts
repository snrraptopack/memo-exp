import { afterEach, expect, it } from 'bun:test';
import { createListRegion, register, registeredIds, unregister } from '@memoized-dom/runtime/testing';

afterEach(() => {
  for (const id of registeredIds()) if (id.startsWith('persistent-')) unregister(id);
  document.body.replaceChildren();
});

it('keeps consumed keys hidden, remaining size and forward effects during a mixed frame', () => {
  const host = document.createElement('ul'); document.body.append(host);
  const calls: string[] = [], disposed: number[] = [];
  let observing = false;
  const region = createListRegion(host, 'persistent-effects', (initial, _id, initialIndex) => {
    if (observing) calls.push(`c${initial.id}:${region.size()}`);
    const node = document.createElement('li'); let item = initial, index = initialIndex;
    node.textContent = `${item.label}@${index}`;
    return { nodes: node, entities: [],
      update(next, position) { item = next as typeof initial; index = position;
        if (observing) {
          calls.push(`u${item.id}:${region.size()}`);
          // A consumed key is unavailable until commit; an unconsumed old row
          // is still refreshable with its previous item/index bindings.
          if (item.id !== 2) region.refreshKey(item.id);
          if (item.id === 3) region.refreshKey(2);
        }
        node.textContent = `${item.label}@${index}`;
      },

      dispose() { disposed.push(initial.id); if (observing) calls.push(`d${initial.id}:${region.size()}`); },
    };
  }, (item: { id: number; label: string }) => {
    if (observing) calls.push(`k${item.id}:${region.size()}`);
    return item.id;
  }, false);
  region.reconcile([1,2,3].map(id => ({id, label: String(id)})));
  const nodes = [...host.children]; observing = true;
  region.reconcile([{id:3,label:'three'}, {id:4,label:'four'}, {id:1,label:'one'}]);
  expect(calls).toEqual(['k3:3', 'u3:2', 'u2:2', 'k4:2', 'c4:2', 'k1:2', 'u1:1', 'd2:1']);
  expect(region.size()).toBe(3);
  expect([...host.children].map(node => node.textContent)).toEqual(['three@0', 'four@1', 'one@2']);
  expect(host.children[0]).toBe(nodes[2]); expect(host.children[2]).toBe(nodes[0]);
  observing = false; region.dispose();
  expect(disposed).toEqual([2,3,4,1]); expect(host.childNodes).toHaveLength(0);
});

it('keeps already cleaned keys refreshable until the last general removal hook', () => {
  const host = document.createElement('ul'); const updated: number[] = [], disposed: number[] = [];
  const region = createListRegion(host, 'persistent-removal-hooks', item => {
    const node = document.createElement('li'); node.textContent = String(item.id);
    return { nodes:node, entities:[], update() { updated.push(item.id); },
      dispose() { disposed.push(item.id); if (item.id === 2) region.refreshKey(1); },
    };
  }, (item: {id:number}) => item.id, false);
  region.reconcile([1,2,3,4].map(id => ({id})));
  region.reconcile([{id:3}, {id:5}]);
  expect(updated).toEqual([3,1]); expect(disposed).toEqual([1,2,4]);
  expect([...host.children].map(node => node.textContent)).toEqual(['3','5']);
  updated.length = 0; region.refreshKey(1); expect(updated).toEqual([]);
  region.dispose(); expect(disposed).toEqual([1,2,4,3,5]);
});

it('does not dispose removed rows twice if later placement throws', () => {
  const host = document.createElement('ul'); const disposed: number[] = [];
  const region = createListRegion(host, 'persistent-placement-failure', item => {
    const node = document.createElement('li'); node.textContent = String(item.id);
    return { nodes:node, entities:[], dispose() { disposed.push(item.id); } };
  }, (item: {id:number}) => item.id, false);
  region.reconcile([1,2,3,4].map(id => ({id})));
  const insert = host.insertBefore;
  host.insertBefore = () => { throw new Error('placement'); };
  expect(() => region.reconcile([{id:3}, {id:5}])).toThrow('placement');
  host.insertBefore = insert;
  region.dispose();
  expect(disposed).toEqual([1,2,4,3,5]); expect(host.childNodes).toHaveLength(0);
});

it.each(['props', 'update'] as const)('disposes every retained entity when %s throws after consumption', failure => {
  const host = document.createElement('ul'); document.body.append(host);
  const disposed: number[] = []; let throwing = false;
  const region = createListRegion(host, `persistent-${failure}`, initial => {
    const node = document.createElement('li'); node.textContent = initial.label;
    const id = `persistent-${failure}/${initial.id}`;
    register({id, parent:null, render() {}});
    return { nodes:node, entities:[id],
      update() { if (throwing && initial.id === 2 && failure === 'props') throw new Error('props');  if (throwing && initial.id === 2 && failure === 'update') throw new Error('update'); },

      dispose() { disposed.push(initial.id); },
    };
  }, (item: {id:number;label:string}) => item.id);
  region.reconcile([1,2,3].map(id => ({id,label:String(id)})));
  throwing = true;
  expect(() => region.reconcile([1,2,3].map(id => ({id,label:`${id}!`})))).toThrow(failure);
  region.dispose(); region.dispose();
  expect(disposed.sort()).toEqual([1,2,3]); expect(host.childNodes).toHaveLength(0);
  expect(registeredIds().filter(id => id.startsWith(`persistent-${failure}/`))).toEqual([]);
});
