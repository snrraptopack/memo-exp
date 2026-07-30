/**
 * @file TodoStore.ts
 * Plain TypeScript Class Store — zero framework base classes, zero Proxy wrappers.
 */

export interface TodoItem {
  id: number;
  text: string;
  completed: boolean;
}

export type TodoFilter = 'all' | 'active' | 'completed';

export class TodoStore {
  todos: TodoItem[] = [
    { id: 1, text: 'Learn memoized-dom class stores', completed: true },
    { id: 2, text: 'Verify AST mutation analysis on class methods', completed: false },
    { id: 3, text: 'Build a production web app', completed: false },
  ];
  filter: TodoFilter = 'all';
  private nextId = 4;

  addTodo(text: string) {
    if (!text.trim()) return;
    this.todos.push({
      id: this.nextId++,
      text: text.trim(),
      completed: false,
    });
  }

  toggleTodo(id: number) {
    const todo = this.todos.find((t) => t.id === id);
    if (todo) {
      todo.completed = !todo.completed;
    }
  }

  removeTodo(id: number) {
    this.todos = this.todos.filter((t) => t.id !== id);
  }

  setFilter(filter: TodoFilter) {
    this.filter = filter;
  }

  clearCompleted() {
    this.todos = this.todos.filter((t) => !t.completed);
  }
}

// Module-level singleton instance
export const todoStore = new TodoStore();
