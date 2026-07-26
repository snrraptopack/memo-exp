import { todos, completedSet, categoryMap, state } from './db';
import { fetchRemoteTodos } from './api';
import { TodoItem } from './TodoItem';
import { log } from './logger';


const totalCount = todos.length;
const completedCount = completedSet.size;
const activeCount = totalCount - completedCount;

export function TodoApp() {
  log(() => console.log('TodoApp total count', totalCount));

  log(() => console.log('TodoApp active count', activeCount));

  log(() => console.log('TodoApp completed count', completedCount));

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

      {/* Actions */}
      <div class="actions">
        <button onClick={() => fetchRemoteTodos()} disabled={state.isLoading}>
          {state.isLoading ? '⏳ Loading API...' : '🌐 Load Remote API Todos'}
        </button>
        <button
          onClick={() => {
            const newId = Date.now();
            todos.push({
              id: newId,
              text: `New Task #${todos.length + 1}`
            });
            categoryMap.set(newId, 'General');
          }}
        >
          ➕ Add Task
        </button>
        <button
          onClick={() => {
            const filtered = todos.filter((t) => !completedSet.has(t.id));
            todos.length = 0;
            todos.push(...filtered);
            completedSet.clear();
          }}
        >
          🧹 Clear Completed
        </button>
      </div>

      {/* Todo List */}
      <ul>
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
