import type { ColumnData, Task } from '../types';
import { toggleTask, removeTask } from '../state';

export function TaskCard({
  column,
  task,
}: {
  column: ColumnData;
  task: Task;
}) @{
  <div class={task.completed ? 'task-card completed' : 'task-card'}>

    <div class="task-header">
      <span class="category-tag">{task.category}</span>
      <div class="task-actions">
        <button class="btn-icon" onClick={() => toggleTask(task)} aria-label="Toggle task status">
          @if (task.completed) {
            <span>✓</span>
          } @else {
            <span>○</span>
          }
        </button>
        <button class="btn-icon btn-delete" onClick={() => removeTask(column, task.id)} aria-label="Delete task">
          ✕
        </button>
      </div>
    </div>

    <p class="task-title">{task.title}</p>

    <div class="task-meta">
      @if (task.priority === 'high') {
        <span class="priority-badge priority-high">High Priority</span>
      } @else if (task.priority === 'medium') {
        <span class="priority-badge priority-medium">Medium</span>
      } @else {
        <span class="priority-badge priority-low">Low</span>
      }
    </div>

    <style>
      .task-card {
        padding: 0.85rem 1rem;
        background: #1e222b;
        border: 1px solid #333a48;
        border-radius: 0.75rem;
        display: flex;
        flex-direction: column;
        gap: 0.65rem;
        transition: transform 0.15s ease, border-color 0.15s ease;
      }
      .task-card:hover {
        border-color: #4a5568;
        transform: translateY(-1px);
      }
      .task-card.completed {
        opacity: 0.6;
      }
      .task-card.completed .task-title {
        text-decoration: line-through;
        color: #8c96a8;
      }
      .task-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
      }
      .task-title {
        font-size: 0.95rem;
        font-weight: 500;
        color: #e2e8f0;
        margin: 0;
        line-height: 1.35;
      }
      .task-meta {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 0.2rem;
      }
      .category-tag {
        font-size: 0.72rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        padding: 0.15rem 0.45rem;
        background: #28303f;
        color: #90cdf4;
        border-radius: 0.35rem;
      }
      .priority-badge {
        font-size: 0.72rem;
        font-weight: 600;
        padding: 0.15rem 0.45rem;
        border-radius: 0.35rem;
      }
      .priority-high {
        background: rgb(245 101 101 / 20%);
        color: #feb2b2;
      }
      .priority-medium {
        background: rgb(237 137 54 / 20%);
        color: #fbd38d;
      }
      .priority-low {
        background: rgb(72 187 120 / 20%);
        color: #9ae6b4;
      }
      .task-actions {
        display: flex;
        align-items: center;
        gap: 0.4rem;
      }
      .btn-icon {
        background: transparent;
        border: 0;
        color: #a0aec0;
        cursor: pointer;
        padding: 0.25rem 0.5rem;
        border-radius: 0.35rem;
        font-size: 0.8rem;
      }
      .btn-icon:hover {
        background: #2d3748;
        color: #e2e8f0;
      }
      .btn-delete:hover {
        background: rgb(245 101 101 / 20%);
        color: #fc8181;
      }
    </style>

  </div>
}
