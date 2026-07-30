/**
 * @file KanbanApp.tsx
 * Root component for the Kanban Studio example.
 * Demonstrates R33 (Named Conditional Effect), R34 (Inline Row Composition),
 * R35 (Helper Dynamic Tags), and R36 (JSX Render Props / Collections).
 */
import {
  columns,
  isSyncingEnabled,
  lastSyncTime,
  toggleSync,
  addTask,
} from './kanban-state';
import { KanbanColumn } from './KanbanColumn';

export function KanbanApp() {
  console.log('⚡ [RENDER] KanbanApp root component executed');

  let newTitle = '';
  let newTag: 'bug' | 'feature' | 'design' = 'feature';
  let newPoints = 3;

  const totalTasks = columns.reduce((acc, col) => acc + col.tasks.length, 0);

  const handleCreateTask = (e: any) => {
    e.preventDefault();
    if (newTitle.trim()) {
      addTask(newTitle, newTag, newPoints);
      newTitle = '';
    }
  };

  return (
    <div class="kanban-app-container">
      <header class="kanban-header">
        <h1>📌 Memoized DOM Kanban Board</h1>
        <p class="subtitle">
          Demonstrating <strong>R33 Conditional Effects</strong>, <strong>R34 Nested Rows</strong>, <strong>R35 Helper Dynamic Tags</strong>, & <strong>R36 JSX Render Props</strong>.
        </p>

        <form class="add-task-form" onSubmit={handleCreateTask}>
          <input
            type="text"
            placeholder="Enter new task title..."
            value={newTitle}
            onInput={(e: any) => { newTitle = e.target.value; }}
          />
          <select
            value={newTag}
            onChange={(e: any) => { newTag = e.target.value; }}
          >
            <option value="feature">Feature</option>
            <option value="bug">Bug</option>
            <option value="design">Design</option>
          </select>
          <input
            type="number"
            min="1"
            max="13"
            value={newPoints}
            onInput={(e: any) => { newPoints = Number(e.target.value); }}
          />
          <button type="submit" class="btn primary">Add Task</button>
        </form>

        <div class="sync-bar">
          <button
            class={`sync-toggle-btn ${isSyncingEnabled ? 'active' : ''}`}
            onClick={() => toggleSync()}
          >
            {isSyncingEnabled ? '⚡ Live Sync Enabled' : '⏸ Sync Paused'}
          </button>
          <span class="sync-status">Tasks: {totalTasks} | Status: {lastSyncTime}</span>
        </div>
      </header>

      <main class="kanban-grid">
        {/* R34: Keyed column iteration rendering KanbanColumn with nested child component mappings */}
        {columns.map((col) => (
          <KanbanColumn key={col.id} column={col} />
        ))}
      </main>
    </div>
  );
}
