import { board } from './state';
import { renameItem, toggleItem } from './helpers';

export function addTodo(title: string): void {
  board.todos.push({ id: board.nextId++, title, done: false });
}

export function toggleFirst(): void {
  const first = board.todos[0];
  if (first) toggleItem(first);
}

export function renameFirst(title: string): void {
  const first = board.todos[0];
  if (first) renameItem(first, title);
}

export function setFilter(filter: 'all' | 'open' | 'done'): void {
  board.filter = filter;
}
