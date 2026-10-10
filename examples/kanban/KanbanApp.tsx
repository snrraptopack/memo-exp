/**
 * @file KanbanApp.tsx
 * Root component for the Kanban Studio example.
 * Demonstrates R33 (Named Conditional Effect), R34 (Inline Row Composition),
 * R35 (Helper Dynamic Tags), R36 (JSX Render Props / Collections), and the
 * R40-R43 static composition phase.
 */
import {
  columns,
  isSyncingEnabled,
  lastSyncTime,
  toggleSync,
  addTask,
} from './kanban-state';
import { KanbanColumn } from './KanbanColumn';

const BoardList = ({ items, renderItem }: {
  items: typeof columns;
  renderItem: (item: (typeof columns)[number]) => JSX.Child;
}) => (
  <div class="kanban-grid">
    {items.map((item) => renderItem(item))}
  </div>
);

const RepeatedFeature = ({ content }: { content: JSX.Child }) => (
  <div class="composition-feature">
    <span>Compiled twice:</span>
    <b>{content}</b>
    <i>{content}</i>
  </div>
);

export const KanbanApp = () => {
  console.log('⚡ [RENDER] KanbanApp root component executed');

  let newTitle = '';
  let newTag: 'bug' | 'feature' | 'design' = 'feature';
  let newPoints = 3;

  const totalTasks = columns.reduce((acc, col) => acc + col.tasks.length, 0);

  const handleCreateTask = (e: SubmitEvent) => {
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
          Demonstrating static effects, nested rows, render slots, and caller-owned render callbacks.
        </p>
        <RepeatedFeature content={<small>stable slot identity</small>} />

        <form class="add-task-form" onSubmit={handleCreateTask}>
          <input
            type="text"
            placeholder="Enter new task title..."
            value={newTitle}
            onInput={e => { newTitle = e.currentTarget.value; }}
          />
          <select
            value={newTag}
            onChange={e => { newTag = e.currentTarget.value as typeof newTag; }}
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
            onInput={e => { newPoints = Number(e.currentTarget.value); }}
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

      {/* R40 arrow component + R41 linked caller-owned render callback +
          R42 calculated collection source. */}
      <main>
        <BoardList
          items={columns.filter((column) => column.tasks.length >= 0)}
          renderItem={(column) => (
            <KanbanColumn key={column.id} column={column} />
          )}
        />
      </main>
    </div>
  );
};
