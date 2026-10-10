/**
 * @file KanbanCard.tsx
 * Demonstrates R36 — JSX Render Props (header, body, footer passed as JSX nodes).
 */
import { setDraggedTask, type Task } from './kanban-state';

export interface KanbanCardProps {
  task: Task;
  headerSlot: JSX.Child;
  footerSlot: JSX.Child;
}

export function KanbanCard({ task, headerSlot, footerSlot }: KanbanCardProps) {
  console.log(`⚡ [RENDER] KanbanCard [${task.id}: ${task.title}] executed`);

  let isDragging = false;

  return (
    <article
      class={`kanban-card-shell ${isDragging ? 'is-dragging' : ''}`}
      draggable={true}
      onDragStart={e => {
        isDragging = true;
        setDraggedTask(task.id);
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/plain', task.id);
          e.dataTransfer.effectAllowed = 'move';
        }
      }}
      onDragEnd={() => {
        isDragging = false;
        setDraggedTask(null);
      }}
    >
      <header class="card-header">{headerSlot}</header>
      <div class="card-body">
        <p class="card-title">{task.title}</p>
      </div>
      <footer class="card-footer">{footerSlot}</footer>
    </article>
  );
}
