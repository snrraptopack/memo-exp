import { removeTask, todoStore, type Todo } from './state';

interface TodoRowProps {
  todo: Todo;
  index: number;
}

export function TodoRow({ todo, index }: TodoRowProps) {
  let clicks = 0;

  return (
    <li
      class={todo.done ? 'todo-row is-completed' : 'todo-row'}
      hidden={
        (todoStore.filter === 'active' && todo.done) ||
        (todoStore.filter === 'completed' && !todo.done)
      }
    >
      <button
        class="todo-check"
        data-action="toggle"
        aria-label={todo.done ? 'Mark task active' : 'Complete task'}
        aria-pressed={todo.done}
        onClick={() => { todo.done = !todo.done; }}
      >
        {todo.done ? '✓' : '○'}
      </button>

      <div class="todo-copy">
        <button
          class="todo-title"
          data-action="rename"
          onClick={() => {
            todo.title = todo.title.endsWith(' (edited)')
              ? todo.title.slice(0, -9)
              : `${todo.title} (edited)`;
          }}
        >
          {todo.title}
        </button>
        <span class="todo-meta">Task #{todo.id} · Position {index + 1}</span>
      </div>

      <button
        class="click-badge"
        data-action="local"
        title="This count stays with its task when reordered"
        onClick={() => { clicks++; }}
      >
        Clicks {clicks}
      </button>

      <button
        class="remove-button"
        data-action="remove"
        aria-label={`Remove ${todo.title}`}
        onClick={() => { removeTask(todo.id); }}
      >
        Remove
      </button>
    </li>
  );
}
