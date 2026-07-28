import { todos, completedSet, categoryMap, state } from './db';
import { fetchRemoteTodos } from './api';
import { TodoItem } from './TodoItem';

const totalCount = todos.length;
const completedCount = completedSet.size;
const activeCount = totalCount - completedCount;

export function TodoApp() {
  effect(() => console.log('TodoApp total count', totalCount));

  effect(() => console.log('TodoApp active count', activeCount));

  effect(() => console.log('TodoApp completed count', completedCount));

  return (
    <div class="todo-card">
      <h1>⚡ Multi-Module Memoized DOM App</h1>
      <p class="subtitle">{state.statusMessage}</p>

      {/* Stats Bar */}
      <div class="stats-bar">
        <div class="stat-pill">Total: <strong>{totalCount}</strong></div>
        <div class="stat-pill">Active: <strong>{activeCount}</strong></div>
        <div class="stat-pill">Completed: <strong>{completedCount}</strong></div>
      </div>

      {/* Control Actions */}
      <div class="actions">
        <button
          class="btn primary"
          onClick={() => {
            todos.push({
              id: Date.now(),
              text: `Local Todo #${todos.length + 1}`
            });
          }}
        >
          ➕ Add Local Todo
        </button>

        <button
          class="btn secondary"
          onClick={() => fetchRemoteTodos()}
          disabled={state.isLoading}
        >
          {state.isLoading ? '⌛ Loading...' : '🌐 Load Remote API Todos'}
        </button>
      </div>

      {/* Todo List */}
      <ul class="todo-list">
        {todos.map((item) => (
          <TodoItem
            key={item.id}
            item={item}
            completedSet={completedSet}
            categoryMap={categoryMap}
          />
        ))}
      </ul>
    </div>
  );
}
