import type { Task, TaskPriority, TaskStatus } from './types';

interface TaskCardProps {
  task: Task;
  onUpdateStatus: (task: Task, nextStatus: TaskStatus) => void;
  onDelete: (task: Task) => void;
}

function getPriorityBadgeClass(priority: TaskPriority): string {
  switch (priority) {
    case 'critical':
      return 'priority-badge priority-critical';
    case 'high':
      return 'priority-badge priority-high';
    case 'medium':
      return 'priority-badge priority-medium';
    case 'low':
      return 'priority-badge priority-low';
  }
}

function getNextStatus(current: TaskStatus): TaskStatus {
  if (current === 'todo') return 'in_progress';
  if (current === 'in_progress') return 'done';
  return 'todo';
}

function getStatusButtonText(current: TaskStatus): string {
  if (current === 'todo') return '→ Start Task';
  if (current === 'in_progress') return '✓ Complete';
  return '↺ Reopen';
}

export function TaskCard({ task, onUpdateStatus, onDelete }: TaskCardProps) {
  const isOptimistic = task.id.startsWith('temp-') || task.isOptimistic === true;

  return (
    <article class={`task-card ${isOptimistic ? 'is-optimistic' : ''}`}>
      <div class="task-card-header">
        <div class="task-card-meta">
          <span class="category-pill">{task.category}</span>
          <span class={getPriorityBadgeClass(task.priority)}>
            {task.priority.toUpperCase()}
          </span>
          {isOptimistic && (
            <span class="optimistic-tag" title="Optimistic update rendered locally ahead of server response">
              ⚡ Optimistic (Pending)
            </span>
          )}
        </div>
        <button
          class="btn-delete"
          onClick={() => onDelete(task)}
          title="Delete task with optimistic list removal"
        >
          🗑️
        </button>
      </div>

      <h3 class="task-title">{task.title}</h3>
      {task.description && <p class="task-description">{task.description}</p>}

      <div class="task-card-footer">
        <span class={`status-indicator status-${task.status}`}>
          <span class="status-dot"></span>
          {task.status.replace('_', ' ').toUpperCase()}
        </span>

        <button
          class="btn-status-cycle"
          onClick={() => onUpdateStatus(task, getNextStatus(task.status))}
        >
          {getStatusButtonText(task.status)}
        </button>
      </div>
    </article>
  );
}
