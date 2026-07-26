/**
 * @file todo-list.ts
 * HAND-COMPILED component: a keyed list of row ENTITIES.
 *
 * Demonstrates the M2 contract:
 *   - rows are entities with hierarchical ids (App/TodoList/Row[3])
 *   - row interactions dirty the ROW only; the list is not re-rendered
 *   - list changes (add/remove/reorder) go through the commit cycle:
 *     handler mutates `items` -> markDirty(listId) -> render() -> reconcile()
 */
import { register, markDirty, type EntityId } from '@memoized-dom/runtime';
import { createListRegion, type ListEntry } from '@memoized-dom/runtime';
import { setText, setClass, type SlotCache } from '@memoized-dom/runtime';

export interface Todo {
  id: number;
  label: string;
  done: boolean;
}

function TodoRow(
  rowId: EntityId,
  listId: EntityId,
  todo: Todo,
  onToggle: (t: Todo) => void,
): ListEntry {
  const $: SlotCache = {};
  const li = document.createElement('li');
  const text = document.createTextNode('');
  li.appendChild(text);
  li.onclick = () => onToggle(todo);

  function update() {
    setText($, 'label', text, todo.label);
    setClass($, 'done', li, 'done', todo.done);
  }

  register({ id: rowId, parent: listId, render: update });
  update(); // mount seed

  return { nodes: [li], entities: [rowId] };
}

export interface TodoListHandle {
  root: HTMLDivElement;
  setItems(next: Todo[]): void;
}

export function TodoList(
  id: EntityId,
  parent: EntityId | null,
  initial: Todo[],
): TodoListHandle {
  let items: readonly Todo[] = initial;

  const root = document.createElement('div');
  const addBtn = document.createElement('button');
  addBtn.textContent = 'add';
  const ul = document.createElement('ul');
  root.append(addBtn, ul);

  const toggle = (t: Todo) => {
    t.done = !t.done;
    markDirty(`${id}/Row[${t.id}]`); // row-level update; the LIST is untouched
  };

  const list = createListRegion<Todo>(
    ul,
    id,
    (todo, rowId) => TodoRow(rowId, id, todo, toggle),
    (t) => t.id,
  );

  let nextId = 10_000;
  addBtn.onclick = () => {
    items = [...items, { id: nextId, label: `todo ${nextId}`, done: false }];
    nextId++;
    markDirty(id); // list-level change goes through the commit cycle
  };

  register({
    id,
    parent,
    render() {
      list.reconcile(items);
    },
  });
  list.reconcile(items); // mount seed

  return {
    root,
    setItems(next: Todo[]) {
      items = next;
      markDirty(id);
    },
  };
}
