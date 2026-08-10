import type { Todo } from './state';

export function toggleItem(todo: Todo): void {
  todo.done = !todo.done;
}

export function renameItem(todo: Todo, title: string): void {
  todo.title = title;
}
