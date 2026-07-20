import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setScheduler,
  resetScheduler,
  unregister,
  _internals,
} from '../src/kernel';
import { createListRegion, type ListEntry } from '../src/list';
import { TodoList, type Todo } from '../examples/todo-list';

function freshTodos(): Todo[] {
  return [
    { id: 1, label: 'one', done: false },
    { id: 2, label: 'two', done: false },
    { id: 3, label: 'three', done: false },
  ];
}

describe('M2 keyed list reconciliation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    _internals().registry.forEach((_, id) => unregister(id));
    setScheduler((fn) => fn()); // synchronous commit
  });
  afterEach(() => resetScheduler());

  it('mounts rows as entities with hierarchical ids', () => {
    const { root } = TodoList('App/TodoList', null, freshTodos());
    document.body.appendChild(root);

    const ul = root.querySelector('ul')!;
    expect(ul.querySelectorAll('li').length).toBe(3);
    expect(ul.textContent).toBe('onetwothree');

    const reg = _internals().registry;
    expect(reg.has('App/TodoList')).toBe(true);
    expect(reg.has('App/TodoList/Row[1]')).toBe(true);
    expect(reg.has('App/TodoList/Row[2]')).toBe(true);
    expect(reg.has('App/TodoList/Row[3]')).toBe(true);
  });

  it('row interaction dirties the ROW only — list render never runs', () => {
    const { root } = TodoList('App/TodoList', null, freshTodos());
    document.body.appendChild(root);

    const reg = _internals().registry;
    let listRenders = 0;
    let rowRenders = 0;
    const listEntity = reg.get('App/TodoList')!;
    const origList = listEntity.render;
    listEntity.render = () => { listRenders++; origList(); };
    const rowEntity = reg.get('App/TodoList/Row[2]')!;
    const origRow = rowEntity.render;
    rowEntity.render = () => { rowRenders++; origRow(); };

    const li = root.querySelectorAll('li')[1] as HTMLElement;
    li.click();

    expect(li.classList.contains('done')).toBe(true);
    expect(rowRenders).toBe(1);
    expect(listRenders).toBe(0); // the list was NOT re-rendered
  });

  it('reorder MOVES existing nodes — same element references, zero recreation', () => {
    const items = freshTodos();
    const { root, setItems } = TodoList('App/TodoList', null, items);
    document.body.appendChild(root);

    const ul = root.querySelector('ul')!;
    const before = [...ul.querySelectorAll('li')];

    setItems([items[2]!, items[0]!, items[1]!]);

    const after = [...ul.querySelectorAll('li')];
    expect(ul.textContent).toBe('threeonetwo');
    expect(after[0]).toBe(before[2]); // SAME node, moved
    expect(after[1]).toBe(before[0]);
    expect(after[2]).toBe(before[1]);

    expect(_internals().registry.has('App/TodoList/Row[1]')).toBe(true);
  });

  it('removal deletes nodes AND unregisters the row entity subtree', () => {
    const items = freshTodos();
    const { root, setItems } = TodoList('App/TodoList', null, items);
    document.body.appendChild(root);

    setItems([items[0]!, items[2]!]);

    const ul = root.querySelector('ul')!;
    expect(ul.querySelectorAll('li').length).toBe(2);
    expect(ul.textContent).toBe('onethree');
    expect(_internals().registry.has('App/TodoList/Row[2]')).toBe(false);
    expect(_internals().dirtySet.size).toBe(0);
  });

  it('append creates only the new row — existing row nodes untouched', () => {
    const { root } = TodoList('App/TodoList', null, freshTodos());
    document.body.appendChild(root);

    const ul = root.querySelector('ul')!;
    const before = [...ul.querySelectorAll('li')];

    (root.querySelector('button') as HTMLButtonElement).click();

    const after = [...ul.querySelectorAll('li')];
    expect(after.length).toBe(4);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[2]).toBe(before[2]);
    expect(after[3]!.textContent).toContain('todo 10000');
  });

  it('unchanged list reconcile performs ZERO DOM operations', () => {
    const items = freshTodos();
    const { root, setItems } = TodoList('App/TodoList', null, items);
    document.body.appendChild(root);

    const ul = root.querySelector('ul')!;
    let insertions = 0;
    let removals = 0;
    const origInsert = ul.insertBefore.bind(ul);
    const origRemove = ul.removeChild.bind(ul);
    (ul as any).insertBefore = (n: Node, ref: Node | null) => {
      insertions++;
      return origInsert(n, ref);
    };
    (ul as any).removeChild = (n: Node) => {
      removals++;
      return origRemove(n);
    };

    setItems(items); // same array, same order
    expect(insertions).toBe(0);
    expect(removals).toBe(0);
  });

  it('key function survives re-fetched data (fresh objects, same ids)', () => {
    const items = freshTodos();
    const { root, setItems } = TodoList('App/TodoList', null, items);
    document.body.appendChild(root);

    const ul = root.querySelector('ul')!;
    const before = [...ul.querySelectorAll('li')];

    // simulate a re-fetch: brand-new objects, same logical ids
    setItems([
      { id: 1, label: 'one', done: false },
      { id: 2, label: 'two', done: true },
      { id: 3, label: 'three', done: false },
    ]);

    const after = [...ul.querySelectorAll('li')];
    expect(after[0]).toBe(before[0]); // NOT recreated
    expect(after[1]).toBe(before[1]);
    expect(after[2]).toBe(before[2]);
  });

  it('identity keys (no key fn): objects keyed by reference', () => {
    const a = { n: 'a' };
    const b = { n: 'b' };
    const ul = document.createElement('ul');
    document.body.appendChild(ul);

    const region = createListRegion(ul, 'App/Plain', (item:{n:string}): ListEntry => {
      const li = document.createElement('li');
      li.textContent = item.n;
      return { nodes: [li], entities: [] };
    });

    region.reconcile([a, b]);
    const firstRender = [...ul.querySelectorAll('li')];

    region.reconcile([b, a]); // reorder by reference
    const secondRender = [...ul.querySelectorAll('li')];

    expect(ul.textContent).toBe('ba');
    expect(secondRender[0]).toBe(firstRender[1]); // moved, not recreated
    expect(secondRender[1]).toBe(firstRender[0]);
  });

  it('duplicate keys throw a clear error', () => {
    const ul = document.createElement('ul');
    document.body.appendChild(ul);

    const region = createListRegion(
      ul,
      'App/Dup',
      (item): ListEntry => {
        const li = document.createElement('li');
        li.textContent = String(item);
        return { nodes: [li], entities: [] };
      },
      (x) => x, // primitive identity -> duplicates collide
    );

    expect(() => region.reconcile([1, 1, 2])).toThrow(/duplicate list key/);
  });
});
