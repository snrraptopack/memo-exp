type Todo = {
  id: number;
  title: string;
  done: boolean;
};

export function TsrxTodoApp() @{
  let draft = '';
  let nextId = 4;
  let inputRef: HTMLInputElement | null = null;

  const todos: Todo[] = [
    { id: 1, title: 'Parse TSRX with @tsrx/core', done: true },
    { id: 2, title: 'Lower extensions directly to ESTree', done: true },
    { id: 3, title: 'Design scoped style semantics', done: false },
  ];
  const remaining = todos.filter((todo) => !todo.done).length;


  const addTodo = () => {
    const title = draft.trim();
    if (title === '') return;
    todos.push({ id: nextId++, title, done: false });
    inputRef?.focus();
    draft = '';
  };

  <main class="todo-shell">

    <header>
      <p class="eyebrow">Experimental frontend</p>
      <h1>Memoized DOM + TSRX</h1>
      <p>{remaining} tasks remaining</p>
    </header>

    <div class="composer">
      <input
        aria-label="New task"
        ref={(el) => { inputRef = el; }}
        placeholder="What should happen next?"
        value={draft}
        onInput={(event) => draft = event.currentTarget.value}
        onKeyDown={(event) => {
          if (event.key === 'Enter') addTodo();
        }}
      />
      <button onClick={addTodo}>Add task</button>
    </div>

    <ul class="todo-list">
      @for (const todo of todos; index index; key todo.id) {
        const stateLabel = todo.done ? 'Completed' : 'Active';

        <li class={todo.done ? 'todo done' : 'todo'}>
          <button
            class="toggle"
            aria-label={`Mark ${todo.title} as ${todo.done ? 'active' : 'completed'}`}
            onClick={() => todo.done = !todo.done}
          >
            @if (todo.done) { <span>✓</span> }
            @else { <span>{index + 1}</span> }
          </button>
          <span class="title">{todo.title}</span>
          <small>{stateLabel}</small>
          <button class="remove" onClick={() => todos.splice(index, 1)}>Remove</button>
        </li>
      } @empty {
        <li class="empty">Nothing left. Add another task above.</li>
      }
    </ul>


    <style>
      .todo-shell {
        width: min(42rem, calc(100vw - 2rem));
        margin: 3rem auto;
        padding: clamp(1.25rem, 4vw, 2.5rem);
        border: 1px solid #343946;
        border-radius: 1.5rem;
        background: rgb(24 27 34 / 92%);
        box-shadow: 0 2rem 5rem rgb(0 0 0 / 35%);
      }
      header {
        margin-bottom: 1.5rem;
      }
      h1 {
        margin: 0;
        margin-block: 0.2rem 0.4rem;
        font-size: clamp(2rem, 7vw, 3.5rem);
        letter-spacing: -0.06em;
      }
      p {
        margin: 0;
      }
      .eyebrow {
        color: #8db4ff;
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .composer {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 0.75rem;
      }
      .composer input {
        min-width: 0;
        padding: 0.8rem 1rem;
        color: inherit;
        border: 1px solid #444b5a;
        border-radius: 0.75rem;
        outline: none;
        background: #171a20;
      }
      .composer input:focus {
        border-color: #8db4ff;
        box-shadow: 0 0 0 0.2rem rgb(141 180 255 / 15%);
      }
      .composer button {
        padding-inline: 1.1rem;
        color: #10141d;
        border: 0;
        border-radius: 0.75rem;
        background: #8db4ff;
        font-weight: 700;
      }
      .todo-list {
        margin: 1.25rem 0 0;
        padding: 0;
        display: grid;
        gap: 0.65rem;
        list-style: none;
      }
      .todo {
        padding: 0.75rem;
        display: grid;
        grid-template-columns: auto 1fr auto auto;
        gap: 0.75rem;
        align-items: center;
        border: 1px solid #343946;
        border-radius: 0.85rem;
        background: #1d2028;
      }
      .todo.done .title {
        color: #8a909e;
        text-decoration: line-through;
      }
      .todo small {
        color: #9da4b3;
      }
      .toggle {
        width: 2rem;
        height: 2rem;
        color: #dbe6ff;
        border: 1px solid #4f6084;
        border-radius: 50%;
        background: #28334a;
      }
      .remove {
        padding: 0.35rem 0.55rem;
        color: #ffafb5;
        border: 0;
        background: transparent;
      }
      .empty {
        padding: 2rem;
        color: #9da4b3;
        border: 1px dashed #444b5a;
        border-radius: 0.85rem;
        text-align: center;
      }
      @media (max-width: 36rem) {
        .composer {
          grid-template-columns: 1fr;
        }
        .composer button {
          min-height: 2.8rem;
        }
        .todo {
          grid-template-columns: auto 1fr auto;
        }
        .todo small {
          display: none;
        }
      }
    </style>

  </main>
}
