export interface Todo {
  id: number;
  text: string;
}

// 1. Module-Level State (Rule R7 L1 List Compliance)
let todos: Todo[] = [
  { id: 1, text: 'Master Memoized DOM Compiler' },
  { id: 2, text: 'Test Real-World Async API Fetching' },
  { id: 3, text: 'Verify Zero-Import Reactivity' }
];

let isLoading = false;
let statusMessage = 'Ready';

// 2. Set & Map Collections
const completedSet = new Set<number>([1]);
const categoryMap = new Map<number, string>([
  [1, 'Compiler'],
  [2, 'Network'],
  [3, 'Performance']
]);

// 3. Computed Derivations (Rule R13)
const totalCount = todos.length;
const completedCount = completedSet.size;
const activeCount = totalCount - completedCount;

// 4. Async API Fetch Handler
async function fetchRemoteTodos() {
  isLoading = true;
  statusMessage = 'Fetching 10 live todos from JSONPlaceholder API...';

  try {
    const res = await fetch('https://jsonplaceholder.typicode.com/todos?_limit=10');
    const data = await res.json();

    todos = data.map((item: any) => ({
      id: item.id + 100,
      text: item.title
    }));

    completedSet.clear();
    data.forEach((item: any) => {
      if (item.completed) completedSet.add(item.id + 100);
    });

    statusMessage = 'Successfully loaded remote API todos!';
  } catch (err) {
    statusMessage = 'Failed to fetch remote todos!';
  } finally {
    isLoading = false;
  }
}

// 5. Item Component
function TodoItem(props: { item: Todo }) {
  const isDone = completedSet.has(props.item.id);
  const category = categoryMap.get(props.item.id) || 'General';

  return (
    <li class={isDone ? 'todo-item done' : 'todo-item'}>
      <div class="todo-content">
        <span
          class="todo-check"
          onClick={() => {
            if (completedSet.has(props.item.id)) {
              completedSet.delete(props.item.id);
            } else {
              completedSet.add(props.item.id);
            }
          }}
        >
          {isDone ? '☑' : '☐'}
        </span>
        <span class="todo-text">{props.item.text}</span>
        <span
          class="todo-badge"
          onClick={() => {
            const nextCat =
              category === 'Compiler'
                ? 'Network'
                : category === 'Network'
                ? 'Performance'
                : 'Compiler';
            categoryMap.set(props.item.id, nextCat);
          }}
        >
          🏷️ {category}
        </span>
      </div>
    </li>
  );
}

// 6. Main Application Component
export function TodoApp() {
  return (
    <div class="todo-card">
      <h1>⚡ Advanced Reactive Todo App</h1>
      <p class="subtitle">{statusMessage}</p>

      {/* Stats Bar */}
      <div class="stats-bar">
        <div class="stat-pill">Total: <strong>{totalCount}</strong></div>
        <div class="stat-pill">Active: <strong>{activeCount}</strong></div>
        <div class="stat-pill">Completed: <strong>{completedCount}</strong></div>
      </div>

      {/* Actions */}
      <div class="actions">
        <button onClick={() => fetchRemoteTodos()} disabled={isLoading}>
          {isLoading ? '⏳ Loading API...' : '🌐 Load Remote API Todos'}
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
            todos = todos.filter((t) => !completedSet.has(t.id));
            completedSet.clear();
          }}
        >
          🧹 Clear Completed
        </button>
      </div>

      {/* Todo List */}
      <ul>
        {todos.map((item) => (
          <TodoItem key={item.id} item={item} />
        ))}
      </ul>
    </div>
  );
}
