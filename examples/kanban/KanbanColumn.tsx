/**
 * @file KanbanColumn.tsx
 * Demonstrates R34 (Nested Lists & Child Components inside Keyed Rows)
 * and R35 (Helper Dynamic Tag Candidates).
 */
import {
  moveTask,
  draggedTaskId,
  setDraggedTask,
  type Column,
} from './kanban-state';
import { KanbanCard } from './KanbanCard';

export interface KanbanColumnProps {
  column: Column;
}

// R35: Helper function returning dynamic host tag candidates ("section" | "article" | "aside")
function chooseColumnTag(colId: string) {
  if (colId === 'todo') return 'section';
  if (colId === 'in-progress') return 'article';
  return 'aside';
}

export function KanbanColumn({ column }: KanbanColumnProps) {
  console.log(`⚡ [RENDER] KanbanColumn [${column.id}] executed`);

  // R35: Dynamic Tag candidate resolved from helper call
  const HostTag = chooseColumnTag(column.id);

  let isDragOver = false;

  const handleDragOver = (e: any) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    isDragOver = true;
  };

  const handleDragLeave = () => {
    isDragOver = false;
  };

  const handleDrop = (e: any) => {
    e.preventDefault();
    isDragOver = false;
    const targetTaskId = draggedTaskId || (e.dataTransfer ? e.dataTransfer.getData('text/plain') : null);
    if (targetTaskId) {
      moveTask(targetTaskId, column.id);
      setDraggedTask(null);
    }
  };

  return (
    <HostTag
      class={`kanban-column column-${column.id} ${isDragOver ? 'is-drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div class="column-header">
        <h3>{column.title}</h3>
        <span class="count-badge">{column.tasks.length}</span>
      </div>

      <div class="task-list">
        {/* R34: Keyed row list containing child components and nested task mappings */}
        {column.tasks.map((task) => (
          <div key={task.id} class="task-wrapper">
            <KanbanCard
              task={task}
              // R36: JSX Render Props passed directly
              headerSlot={<span class={`tag-pill tag-${task.tag}`}>{task.tag}</span>}
              footerSlot={
                <div class="card-actions">
                  <span class="points-badge">{task.points} pts</span>
                  <div class="move-btns">
                    {column.id !== 'todo' && (
                      <button
                        class="move-btn"
                        onClick={() => moveTask(task.id, column.id === 'done' ? 'in-progress' : 'todo')}
                      >
                        ←
                      </button>
                    )}
                    {column.id !== 'done' && (
                      <button
                        class="move-btn"
                        onClick={() => moveTask(task.id, column.id === 'todo' ? 'in-progress' : 'done')}
                      >
                        →
                      </button>
                    )}
                  </div>
                </div>
              }
            />
          </div>
        ))}
      </div>
    </HostTag>
  );
}
