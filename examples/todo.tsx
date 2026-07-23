export interface Todo {
  id: number;
  text: string;
  done: boolean;
}

let todos: Todo[] = [
  { id: 1, text: 'Learn Memoized DOM Compiler', done: true },
  { id: 2, text: 'Build a Live Todo App', done: false },
  { id: 3, text: 'Benchmark Performance', done: false }
];

const count = todos.filter((it)=> it.done).length

function TodoItem(props: { item: Todo }) {
  return (
    <li class={props.item.done ? 'todo-item done' : 'todo-item'}>
      <span
        onClick={() => {
          props.item.done = !props.item.done;
        }}
      >
        {props.item.done ? '☑ ' : '☐ '}
        {props.item.text}
      </span>
    </li>
  );
}

export function TodoApp() {
  let timer = 0
  const startTimer = () => setInterval(()=> timer++,1000)

  return (
    <div class="todo-card">
      <h1>⚡ Memoized DOM Todo App { timer}</h1>
      <p class="subtitle">Built with Reactive Memoized DOM { count}</p>

      <div class="actions">
        <button
          onClick={() => {
            todos.push({
              id: Date.now(),
              text: `New Task #${todos.length + 1}`,
              done: false
            });
          }}
        >
          ➕ Add Task
        </button>
        <button
          onClick={() => {
            todos = todos.filter((t) => !t.done);
            startTimer()
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
