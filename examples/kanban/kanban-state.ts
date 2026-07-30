/**
 * @file kanban-state.ts
 * Module state and R33 named conditional effect for the Kanban Studio.
 */

export interface Task {
  id: string;
  title: string;
  tag: 'bug' | 'feature' | 'design';
  points: number;
}

export interface Column {
  id: string;
  title: string;
  tasks: Task[];
}

export let columns: Column[] = [
  {
    id: 'todo',
    title: '📋 To Do',
    tasks: [
      { id: 't1', title: 'Implement R33-R36 compiler passes', tag: 'feature', points: 5 },
      { id: 't2', title: 'Fix CSS grid alignment on Kanban cards', tag: 'bug', points: 2 },
    ],
  },
  {
    id: 'in-progress',
    title: '⚡ In Progress',
    tasks: [
      { id: 't3', title: 'Design system slot layout engine', tag: 'design', points: 8 },
    ],
  },
  {
    id: 'done',
    title: '✅ Done',
    tasks: [
      { id: 't4', title: 'Compile-time access table analysis', tag: 'feature', points: 3 },
    ],
  },
];

export let isSyncingEnabled = false;
export let lastSyncTime = 'Disabled';
export let draggedTaskId: string | null = null;

export function setDraggedTask(id: string | null) {
  draggedTaskId = id;
}

// R33: Named helper function passed to effect() with disposer cleanup
function syncSocketEffect() {
  lastSyncTime = `Connected (${new Date().toLocaleTimeString()})`;
  const timer = setInterval(() => {
    lastSyncTime = `Synced at ${new Date().toLocaleTimeString()}`;
  }, 2000);

  return () => {
    clearInterval(timer);
    lastSyncTime = 'Disconnected';
  };
}

// R33: Conditional effect activation inside an if statement
if (isSyncingEnabled) {
  effect(syncSocketEffect);
}

export function toggleSync() {
  isSyncingEnabled = !isSyncingEnabled;
}

export function moveTask(taskId: string, targetColId: string) {
  let foundTask: Task | null = null;

  // Remove from old column
  const updatedColumns = columns.map((col) => {
    const task = col.tasks.find((t) => t.id === taskId);
    if (task) foundTask = task;
    return {
      ...col,
      tasks: col.tasks.filter((t) => t.id !== taskId),
    };
  });

  // Add to target column
  if (foundTask) {
    const taskToMove = foundTask;
    columns = updatedColumns.map((col) => {
      if (col.id === targetColId) {
        return { ...col, tasks: [...col.tasks, taskToMove] };
      }
      return col;
    });
  } else {
    columns = updatedColumns;
  }
}

export function addTask(title: string, tag: 'bug' | 'feature' | 'design', points: number) {
  if (!title.trim()) return;
  const newTask: Task = {
    id: `t_${Date.now()}`,
    title: title.trim(),
    tag,
    points,
  };
  columns = columns.map((col) => {
    if (col.id === 'todo') {
      return { ...col, tasks: [newTask, ...col.tasks] };
    }
    return col;
  });
}
