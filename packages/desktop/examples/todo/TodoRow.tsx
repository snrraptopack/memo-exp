import type {} from '@memoized-dom/compiler/jsx';
import './todo.css';

interface TodoRowProps {
  id: number;
  title: string;
  done: boolean;
  onToggle(id: number): void;
  onDelete(id: number): void;
}

export function TodoRow({ id, title, done, onToggle, onDelete }: TodoRowProps) {
  let note = '';
  return (
    <article class="task-row">
      <div class="task-content">
        {done ? <CompletedTitle title={title} /> : <ActiveTitle title={title} />}
        <p class="task-status">Task #{id}</p>
        <input
          id="row-note"
          class="row-note"
          type="text"
          placeholder="A note that stays with this row"
          value={note}
          onInput={(event) => (note = event.currentTarget.value)}
        />
        <p class="note-preview">Note: {note}</p>
      </div>
      <div class="button-group row-actions">
        <button id="toggle-task" class="toggle" onClick={() => onToggle(id)}>
          Complete / undo
        </button>
        <button id="delete-task" class="danger" onClick={() => onDelete(id)}>
          Delete
        </button>
      </div>
    </article>
  );
}

function ActiveTitle({ title }: { title: string }) {
  return <p class="task-title">{title}</p>;
}

function CompletedTitle({ title }: { title: string }) {
  return (
    <p class="task-title completed-title">
      <s>{title}</s>
    </p>
  );
}
