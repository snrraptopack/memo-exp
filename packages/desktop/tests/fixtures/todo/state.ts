export interface Todo {
  id: number;
  title: string;
  done: boolean;
}

export type TodoFilter = 'all' | 'active' | 'completed';

/** Ordinary module state; both renderers use the shared compiler/runtime. */
export const todoStore = {
  nextId: 4,
  filter: 'all' as TodoFilter,
  tasks: [
    { id: 1, title: 'Try the native Todo', done: false },
    { id: 2, title: 'Reorder tasks and check their click counts', done: false },
    { id: 3, title: 'Keep authoring ordinary TSX and CSS', done: true },
  ] as Todo[],
};

export function addTask(): void {
  const id = todoStore.nextId++;
  todoStore.tasks.push({ id, title: `Task ${id}`, done: false });
}

export function reverseTasks(): void {
  todoStore.tasks.reverse();
}

export function removeTask(id: number): void {
  for (let index = 0; index < todoStore.tasks.length; index++) {
    if (todoStore.tasks[index]!.id === id) {
      todoStore.tasks.splice(index, 1);
      return;
    }
  }
}

export function clearCompleted(): void {
  // Walk backwards so removing one task cannot skip the next completed task.
  for (let index = todoStore.tasks.length - 1; index >= 0; index--) {
    if (todoStore.tasks[index]!.done) {
      todoStore.tasks.splice(index, 1);
    }
  }
}

export function remainingTasks(): number {
  let remaining = 0;

  for (const task of todoStore.tasks) {
    if (!task.done) remaining++;
  }

  return remaining;
}
