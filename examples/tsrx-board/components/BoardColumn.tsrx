import type { ColumnData, Priority } from '../types';
import { addTask, searchQuery, selectedCategory } from '../state';
import { TaskCard } from './TaskCard.tsrx';

export function BoardColumn({
  column,
}: {
  column: ColumnData;
}) @{
  let draftTitle = '';
  let draftCategory = 'Frontend';
  let draftPriority: Priority = 'medium';

  const handleAdd = () => {
    const text = draftTitle.trim();
    if (text === '') return;
    addTask(column, text, draftCategory, draftPriority);
    draftTitle = '';
  };

  const q = searchQuery.trim().toLowerCase();
  const tasks = column.tasks.filter((task) => {
    const matchesSearch = q === '' || task.title.toLowerCase().includes(q);
    const matchesCat = selectedCategory === 'All' || task.category === selectedCategory;
    return matchesSearch && matchesCat;
  });

  <div class="board-column">
    <div class="column-header">
      <h2 class="column-title">
        {column.title}
        <span class="column-badge">{tasks.length}</span>
      </h2>
    </div>

    <div class="tasks-container">
      @for (const task of tasks; key task.id) {
        <TaskCard
          column={column}
          task={task}
        />
      } @empty {
        <div class="empty-state">No tasks in this list</div>
      }
    </div>

    <div class="add-composer">
      <input
        class="composer-input"
        placeholder={`Add a task to ${column.title}...`}
        value={draftTitle}
        onInput={(e) => draftTitle = e.currentTarget.value}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleAdd();
        }}
      />
      <div class="composer-options">
        <select
          class="composer-select"
          value={draftCategory}
          onChange={(e) => draftCategory = e.currentTarget.value}
        >
          <option value="Frontend">Frontend</option>
          <option value="Backend">Backend</option>
          <option value="Design">Design</option>
          <option value="DevOps">DevOps</option>
        </select>
        <select
          class="composer-select"
          value={draftPriority}
          onChange={(e) => draftPriority = e.currentTarget.value as Priority}
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <button class="composer-btn" onClick={handleAdd}>+ Add</button>
      </div>
    </div>

    <style>
      .board-column {
        background: #14171f;
        border: 1px solid #282f3d;
        border-radius: 1rem;
        padding: 1.25rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
        min-width: 18rem;
        flex: 1;
      }
      .column-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .column-title {
        font-size: 1.1rem;
        font-weight: 700;
        color: #f7fafc;
        margin: 0;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .column-badge {
        font-size: 0.75rem;
        padding: 0.15rem 0.5rem;
        border-radius: 1rem;
        background: #232936;
        color: #a0aec0;
      }
      .tasks-container {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        min-height: 5rem;
      }
      .empty-state {
        padding: 1.5rem;
        border: 1px dashed #2d3748;
        border-radius: 0.75rem;
        text-align: center;
        color: #718096;
        font-size: 0.85rem;
      }
      .add-composer {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin-top: auto;
        padding-top: 0.75rem;
        border-top: 1px solid #232936;
      }
      .composer-input {
        background: #1e222b;
        border: 1px solid #333a48;
        color: #e2e8f0;
        border-radius: 0.5rem;
        padding: 0.6rem 0.8rem;
        font-size: 0.88rem;
        outline: none;
      }
      .composer-input:focus {
        border-color: #63b3ed;
      }
      .composer-options {
        display: flex;
        gap: 0.5rem;
      }
      .composer-select {
        background: #1e222b;
        border: 1px solid #333a48;
        color: #a0aec0;
        border-radius: 0.5rem;
        padding: 0.4rem 0.5rem;
        font-size: 0.78rem;
        flex: 1;
        outline: none;
      }
      .composer-btn {
        background: #3182ce;
        color: white;
        border: 0;
        border-radius: 0.5rem;
        padding: 0.5rem 0.8rem;
        font-weight: 600;
        font-size: 0.82rem;
        cursor: pointer;
        transition: background 0.15s ease;
      }
      .composer-btn:hover {
        background: #2b6cb0;
      }
    </style>
  </div>
}
