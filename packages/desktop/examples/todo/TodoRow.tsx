import type {} from '@memoized-dom/compiler/jsx';
import './todo.css';

interface TodoRowProps {
  id: number;
  title: string;
  done: boolean;
  onToggle(id: number): void;
  onDelete(id: number): void;
  onReverse(): void;
}

export function TodoRow({ id, title, done, onToggle, onDelete, onReverse }: TodoRowProps) {
  let note = '';
  const handleNoteKey = (event: KeyboardEvent) => {
    if (event.ctrlKey && event.key === 'r') onReverse();
  };
  return (
    <>
      <div class="task-content">
        {done ? (
          <p id="completed-title" class="task-title completed-title">
            <s>{title}</s>
          </p>
        ) : (
          <p id="active-title" class="task-title">{title}</p>
        )}
        <p class="task-status">Task #{id}</p>
        <input
          id="row-note"
          class="row-note"
          type="text"
          placeholder="A note that stays with this row"
          value={note}
          onInput={(event) => (note = event.currentTarget.value)}
          onKeyDown={handleNoteKey}
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
    </>
  );
}
