export interface Todo {
  id: number;
  text: string;
}

// 1. Array Collection
let todos: Todo[] = [
  { id: 1, text: 'Master Memoized DOM Compiler' },
  { id: 2, text: 'Test JavaScript Set & Map Collections' },
  { id: 3, text: 'Verify Computed Derivations' }
];

// 2. Set Collection for Completed IDs (Const Collection)
const completedSet = new Set<number>([1]);

// 3. Map Collection for Todo Categories (Const Collection)
const categoryMap = new Map<number, string>([
  [1, 'Compiler'],
  [2, 'Reactivity'],
  [3, 'Performance']
]);

// 4. Rule R13 Computed Derivations over Collections
const totalCount = todos.length;
const completedCount = completedSet.size;
const activeCount = totalCount - completedCount;

function TodoItem(props: { item: Todo }) {
  return (
    <li class={completedSet.has(props.item.id) ? 'todo-item done' : 'todo-item'}>
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
          {completedSet.has(props.item.id) ? '☑' : '☐'}
        </span>
        <span class="todo-text">{props.item.text}</span>
        <span
          class="todo-badge"
          onClick={() => {
            const current = categoryMap.get(props.item.id) || 'Compiler';
            const nextCat = current === 'Compiler' ? 'Reactivity' : current === 'Reactivity' ? 'Performance' : 'Compiler';
            categoryMap.set(props.item.id, nextCat);
          }}
        >
          🏷️ {categoryMap.get(props.item.id) || 'General'}
        </span>
      </div>
    </li>
  );
}

export function TodoApp() {

  let timer = 0

  setInterval(() => {
    timer++;
  }, 1000);

  return (
    <div class="todo-card">
      <h1>⚡ Advanced Reactive Todo App timer-{timer}</h1>
      <p class="subtitle">Powered by Array, Set & Map Collections</p>

      <div class="stats-bar">
        <div class="stat-pill">Total: <strong>{totalCount}</strong></div>
        <div class="stat-pill">Active: <strong>{activeCount}</strong></div>
        <div class="stat-pill">Completed: <strong>{completedCount}</strong></div>
      </div>

      <div class="actions">
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

      <ul>
        {todos.map((item) => (
          <TodoItem key={item.id} item={item} />
        ))}
      </ul>
    </div>
  );
}
