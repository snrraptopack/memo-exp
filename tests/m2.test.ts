import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setScheduler,
  resetScheduler,
  unregister,
  _internals,
  isStructuralListUpdate,
  listStructureReason,
} from '@memoized-dom/runtime/testing';
import { createListRegion, type ListEntry } from '@memoized-dom/runtime/testing';
import {
  TodoList,
  type Todo,
} from './fixtures/hand-compiled/todo-list';

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

  it('scopes structural reasons to their exact list source', () => {
    const first = listStructureReason('./state.ts#first');
    const second = listStructureReason('./state.ts#second');

    expect(isStructuralListUpdate(first, './state.ts#first')).toBe(true);
    expect(isStructuralListUpdate(first, './state.ts#second')).toBe(false);
    expect(
      isStructuralListUpdate(
        new Set([first, second]),
        './state.ts#first',
      ),
    ).toBe(true);
    expect(
      isStructuralListUpdate(new Set([first, 1]), './state.ts#first'),
    ).toBe(false);
  });

  it('mounts rows as entities with hierarchical ids', () => {
    const { root } = TodoList('App/TodoList', null, freshTodos());
    document.body.appendChild(root);

    const ul = root.querySelector('ul')!;
    expect(ul.querySelectorAll('li').length).toBe(3);
    expect(ul.textContent).toBe('onetwothree');

    const reg = _internals().registry;
    expect(reg.has('App/TodoList')).toBe(true);
    expect(reg.has('App/TodoList/Row[n:1]')).toBe(true);
    expect(reg.has('App/TodoList/Row[n:2]')).toBe(true);
    expect(reg.has('App/TodoList/Row[n:3]')).toBe(true);
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
    const rowEntity = reg.get('App/TodoList/Row[n:2]')!;
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

    expect(_internals().registry.has('App/TodoList/Row[n:1]')).toBe(true);
  });

  it('removal deletes nodes AND unregisters the row entity subtree', () => {
    const items = freshTodos();
    const { root, setItems } = TodoList('App/TodoList', null, items);
    document.body.appendChild(root);

    setItems([items[0]!, items[2]!]);

    const ul = root.querySelector('ul')!;
    expect(ul.querySelectorAll('li').length).toBe(2);
    expect(ul.textContent).toBe('onethree');
    expect(_internals().registry.has('App/TodoList/Row[n:2]')).toBe(false);
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

  it('inserts a new key at its exact derived-array position', () => {
    const ul = document.createElement('ul');
    document.body.appendChild(ul);
    const region = createListRegion(
      ul,
      'App/OrderedInsert',
      (item: { id: number; position: number }): ListEntry => {
        const li = document.createElement('li');
        li.textContent = String(item.id);
        return { nodes: li, entities: [] };
      },
      item => item.id,
    );
    const first = { id: 1, position: 10 };
    const last = { id: 3, position: 30 };
    region.reconcile([first, last]);
    const retained = [...ul.querySelectorAll('li')];

    const inserted = { id: 2, position: 20 };
    region.reconcile([first, inserted, last].sort(
      (left, right) => left.position - right.position,
    ));

    const rows = [...ul.querySelectorAll('li')];
    expect(ul.textContent).toBe('123');
    expect(rows[0]).toBe(retained[0]);
    expect(rows[2]).toBe(retained[1]);
  });

  it('append validation falls back when a retained item key changed', () => {
    const items = [{ id: 1 }, { id: 2 }];
    const ul = document.createElement('ul');
    document.body.appendChild(ul);
    let created = 0;
    const region = createListRegion(
      ul,
      'App/MutableKey',
      (item): ListEntry => {
        created++;
        const li = document.createElement('li');
        li.textContent = String(item.id);
        return { nodes: li, entities: [] };
      },
      (item) => item.id,
    );

    region.reconcile(items);
    const originalFirst = ul.querySelector('li');
    items[0]!.id = 10;
    region.reconcile([...items, { id: 3 }]);

    expect(ul.textContent).toBe('1023');
    expect(ul.querySelector('li')).not.toBe(originalFirst);
    expect(created).toBe(4);
  });

  it('append rejects duplicate tail keys before mounting new rows', () => {
    const ul = document.createElement('ul');
    document.body.appendChild(ul);
    let created = 0;
    const region = createListRegion(
      ul,
      'App/AppendDuplicate',
      (item): ListEntry => {
        created++;
        const li = document.createElement('li');
        li.textContent = String(item.id);
        return { nodes: li, entities: [] };
      },
      (item) => item.id,
    );
    const items = [{ id: 1 }, { id: 2 }];

    region.reconcile(items);
    expect(() => region.reconcile([...items, { id: 2 }])).toThrow(
      /duplicate list key/,
    );
    expect(created).toBe(2);
    expect(ul.textContent).toBe('12');
  });

  it('structure-only updates replay only changed retained identities', () => {
    const ul = document.createElement('ul');
    document.body.appendChild(ul);
    let updates = 0;
    const region = createListRegion(
      ul,
      'App/Structural',
      (initial): ListEntry => {
        let item = initial;
        const li = document.createElement('li');
        li.textContent = item.label;
        return {
          nodes: li,
          entities: [],
          updateProps: (next) => {
            item = next as typeof initial;
          },
          update: () => {
            updates++;
            li.textContent = item.label;
          },
        };
      },
      (item) => item.id,
      false,
      false,
    );
    const first = { id: 1, label: 'one' };
    const second = { id: 2, label: 'two' };
    const third = { id: 3, label: 'three' };

    region.reconcile([first, second]);
    region.reconcile([first, second, third], true);
    expect(updates).toBe(0);

    const replacement = { id: 2, label: 'TWO' };
    region.reconcile([first, replacement, third], true);
    expect(updates).toBe(1);
    expect(ul.textContent).toBe('oneTWOthree');

    region.reconcile([third, replacement, first], true);
    expect(updates).toBe(1);
    expect(ul.textContent).toBe('threeTWOone');
  });

  it('structure-only reorders replay rows whose rendered index can change', () => {
    const ul = document.createElement('ul');
    document.body.appendChild(ul);
    let updates = 0;
    const region = createListRegion(
      ul,
      'App/IndexedStructural',
      (item, _rowId, initialIndex): ListEntry => {
        let index = initialIndex;
        const li = document.createElement('li');
        li.textContent = `${index}:${item.id}`;
        return {
          nodes: li,
          entities: [],
          updateProps: (_next, nextIndex) => {
            index = nextIndex;
          },
          update: () => {
            updates++;
            li.textContent = `${index}:${item.id}`;
          },
        };
      },
      (item) => item.id,
      false,
      true,
    );
    const items = [{ id: 1 }, { id: 2 }];

    region.reconcile(items);
    region.reconcile([...items].reverse(), true);

    expect(updates).toBe(2);
    expect(ul.textContent).toBe('0:21:1');
  });

  it('truncates a stable suffix as one DOM range', () => {
    const ul = document.createElement('ul');
    document.body.appendChild(ul);
    const originalCreateRange = document.createRange;
    let rangeDeletes = 0;
    document.createRange = () => {
      const range = originalCreateRange.call(document);
      const originalDelete = range.deleteContents.bind(range);
      range.deleteContents = () => {
        rangeDeletes++;
        originalDelete();
      };
      return range;
    };

    try {
      const region = createListRegion(
        ul,
        'App/Truncate',
        (item): ListEntry => {
          const li = document.createElement('li');
          li.textContent = String(item.id);
          return { nodes: li, entities: [] };
        },
        (item) => item.id,
      );
      const items = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
      region.reconcile(items);
      region.reconcile(items.slice(0, 2));

      expect(ul.textContent).toBe('12');
      expect(region.size()).toBe(2);
      expect(rangeDeletes).toBe(1);
    } finally {
      document.createRange = originalCreateRange;
    }
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
    Object.defineProperty(ul, 'insertBefore', {
      configurable: true,
      value: (node: Node, reference: Node | null) => {
        insertions++;
        return origInsert(node, reference);
      },
    });
    Object.defineProperty(ul, 'removeChild', {
      configurable: true,
      value: (node: Node) => {
        removals++;
        return origRemove(node);
      },
    });

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

  it('does not allocate per-row hydration markers during client creation', () => {
    const ul = document.createElement('ul');
    const region = createListRegion(
      ul,
      'App/ClientRows',
      (item: { id: number }): ListEntry => {
        const li = document.createElement('li');
        li.textContent = String(item.id);
        return { nodes: li, entities: [] };
      },
      (item) => item.id,
    );

    region.reconcile([{ id: 1 }, { id: 2 }]);

    const rowMarkers = [...ul.childNodes].filter(
      (node) =>
        node.nodeType === Node.COMMENT_NODE &&
        (node as Comment).data.startsWith('mmd:w:'),
    );
    expect(rowMarkers).toEqual([]);
    region.dispose();
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

  it('bulk-deletes the owned range when every key is replaced or cleared', () => {
    const ul = document.createElement('ul');
    document.body.appendChild(ul);
    const originalCreateRange = document.createRange;
    let rangeDeletes = 0;
    document.createRange = () => {
      const range = originalCreateRange.call(document);
      const originalDelete = range.deleteContents.bind(range);
      range.deleteContents = () => {
        rangeDeletes++;
        originalDelete();
      };
      return range;
    };

    try {
      const region = createListRegion(
        ul,
        'App/Bulk',
        (item: { id: number; label: string }): ListEntry => {
          const li = document.createElement('li');
          li.textContent = item.label;
          return { nodes: li, entities: [] };
        },
        (item) => item.id,
      );
      region.reconcile([
        { id: 1, label: 'one' },
        { id: 2, label: 'two' },
      ]);
      region.reconcile([
        { id: 3, label: 'three' },
        { id: 4, label: 'four' },
      ]);
      expect(ul.textContent).toBe('threefour');
      expect(rangeDeletes).toBe(1);

      region.reconcile([]);
      expect(ul.querySelectorAll('li')).toHaveLength(0);
      expect(rangeDeletes).toBe(2);
      region.dispose();
    } finally {
      document.createRange = originalCreateRange;
    }
  });

  it('can omit unique row ids for registry-free repeated rows', () => {
    const ul = document.createElement('ul');
    const seenIds: string[] = [];
    const region = createListRegion(
      ul,
      'App/Light',
      (item: { id: number }, rowId): ListEntry => {
        seenIds.push(rowId);
        return {
          nodes: document.createElement('li'),
          entities: [],
          update: () => {},
        };
      },
      (item) => item.id,
      false,
    );

    region.reconcile([{ id: 1 }, { id: 2 }]);
    expect(seenIds).toEqual(['App/Light', 'App/Light']);
    expect([..._internals().registry.keys()]).toEqual([]);
    region.reconcile([{ id: 2 }, { id: 1 }]);
    region.dispose();
  });

});
