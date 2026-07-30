/**
 * @file ClassTodoApp.tsx
 * Demonstrates a component consuming a plain TypeScript class instance store (todoStore).
 */
import { todoStore } from './TodoStore';

export function ClassTodoApp() {
  let newText = '';

  // Local derived list based on todoStore.filter
  const filteredTodos = todoStore.todos.filter((t) => {
    if (todoStore.filter === 'active') return !t.completed;
    if (todoStore.filter === 'completed') return t.completed;
    return true;
  });

  const completedCount = todoStore.todos.filter((t) => t.completed).length;
  const activeCount = todoStore.todos.length - completedCount;

  const handleAdd = (e: any) => {
    e.preventDefault();
    if (newText.trim()) {
      todoStore.addTodo(newText);
      newText = '';
    }
  };

  return (
    <div class="class-todo-app">
      <header class="todo-header">
        <h1>📦 Class Store Todo App</h1>
        <p class="subtitle">
          Consuming a <strong>plain TS class instance</strong> (<code>new TodoStore()</code>) with zero base classes or Proxies.
        </p>
      </header>

      <div class="todo-card">
        <form class="todo-input-form" onSubmit={handleAdd}>
          <input
            type="text"
            placeholder="What needs to be done?"
            value={newText}
            onInput={(e: any) => { newText = e.target.value; }}
          />
          <button type="submit" class="btn primary">Add Todo</button>
        </form>

        <div class="filter-bar">
          <button
            class={`filter-btn ${todoStore.filter === 'all' ? 'active' : ''}`}
            onClick={() => todoStore.setFilter('all')}
          >
            All ({todoStore.todos.length})
          </button>
          <button
            class={`filter-btn ${todoStore.filter === 'active' ? 'active' : ''}`}
            onClick={() => todoStore.setFilter('active')}
          >
            Active ({activeCount})
          </button>
          <button
            class={`filter-btn ${todoStore.filter === 'completed' ? 'active' : ''}`}
            onClick={() => todoStore.setFilter('completed')}
          >
            Completed ({completedCount})
          </button>
        </div>

        <ul class="todo-list">
          {filteredTodos.map((todo) => (
            <li class={`todo-row ${todo.completed ? 'completed' : ''}`}>
              <input
                type="checkbox"
                checked={todo.completed}
                onChange={() => todoStore.toggleTodo(todo.id)}
              />
              <span class="todo-text">{todo.text}</span>
              <button class="delete-btn" onClick={() => todoStore.removeTodo(todo.id)}>
                ✕
              </button>
            </li>
          ))}
        </ul>

        {completedCount > 0 && (
          <div class="todo-footer">
            <button class="btn secondary danger" onClick={() => todoStore.clearCompleted()}>
              Clear Completed ({completedCount})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
