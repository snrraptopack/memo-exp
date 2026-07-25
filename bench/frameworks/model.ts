/**
 * @file model.ts
 * Supplies deterministic todo data and plain/immutable benchmark operations.
 */
import type { BenchScenario } from './contract';

export interface Todo {
  id: number;
  title: string;
  completed: boolean;
}

export interface Snapshot {
  todos: Todo[];
  revision: number;
  sequence: number;
}

export function makeSnapshot(count: number): Snapshot {
  return {
    todos: Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      title: `Todo ${index + 1}`,
      completed: index % 3 === 0,
    })),
    revision: 0,
    sequence: 0,
  };
}

export function targetIndex(snapshot: Snapshot): number {
  return snapshot.todos.length === 0
    ? 0
    : (snapshot.sequence * 17 + 3) % snapshot.todos.length;
}

export function mutatePlain(snapshot: Snapshot, scenario: BenchScenario): void {
  const index = targetIndex(snapshot);
  const todo = snapshot.todos[index];
  snapshot.sequence++;

  if (scenario === 'no-change') {
    snapshot.revision++;
  } else if (scenario === 'rename' && todo) {
    todo.title = `Todo ${todo.id} / ${snapshot.sequence}`;
  } else if (scenario === 'toggle' && todo) {
    todo.completed = !todo.completed;
  } else if (scenario === 'move' && snapshot.todos.length > 1) {
    const length = snapshot.todos.length;
    const [moved] = snapshot.todos.splice(index, 1);
    snapshot.todos.splice((index + 1) % length, 0, moved!);
  }
}

export function updateImmutable(snapshot: Snapshot, scenario: BenchScenario): Snapshot {
  const index = targetIndex(snapshot);
  const sequence = snapshot.sequence + 1;

  if (scenario === 'no-change') {
    return { ...snapshot, revision: snapshot.revision + 1, sequence };
  }

  if (scenario === 'rename' || scenario === 'toggle') {
    const todos = snapshot.todos.slice();
    const todo = todos[index];
    if (todo) {
      todos[index] =
        scenario === 'rename'
          ? { ...todo, title: `Todo ${todo.id} / ${sequence}` }
          : { ...todo, completed: !todo.completed };
    }
    return { ...snapshot, todos, sequence };
  }

  const todos = snapshot.todos.slice();
  if (todos.length > 1) {
    const length = todos.length;
    const [moved] = todos.splice(index, 1);
    todos.splice((index + 1) % length, 0, moved!);
  }
  return { ...snapshot, todos, sequence };
}

export function remaining(snapshot: Snapshot): number {
  let count = 0;
  for (const todo of snapshot.todos) {
    if (!todo.completed) count++;
  }
  return count;
}
