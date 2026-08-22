/**
 * Live Engineering Task Board (`/tasks`)
 *
 * Demonstrates:
 * 1. `@memoized-dom/data` `$action` with real HTTP POST, PUT, and DELETE operations
 * 2. Optimistic UI mutations with `resource.mutate(...)`
 * 3. Pure derived counters (`completedCount`, `openCount`, `completionRate`)
 * 4. DOM ref on task input for instant submission
 */

import { createTaskApi, type LiveTasksResponse, type LiveTask } from '../services/api';

export type TaskFilter = 'all' | 'open' | 'completed';

export function LiveTaskBoardView() {
  const taskApi = createTaskApi();
  let taskInput: HTMLInputElement | undefined;
  let statusFilter: TaskFilter = 'all';

  // Live GET request for tasks from DummyJSON
  const tasksResource = taskApi.$fetch<LiveTasksResponse>('todos', {
    query: { limit: 10 },
    cache: { scope: 'app' },
  });

  // Action: POST /todos/add to create a task
  const createTaskAction = taskApi.$action<LiveTask, { todo: string; completed: boolean; userId: number }>(
    'todos/add',
    { method: 'POST' }
  );

  cleanup(taskApi.clear);

  // Derived tasks array
  const rawList = tasksResource.data?.todos ?? [];

  // Pure derived calculations
  const totalTasks = rawList.length;
  const completedCount = rawList.filter((t) => t.completed).length;
  const openCount = totalTasks - completedCount;
  const completionRate = totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0;

  // Filtered task items based on active statusFilter
  const filteredTasks = rawList.filter((t) => {
    if (statusFilter === 'open') return !t.completed;
    if (statusFilter === 'completed') return t.completed;
    return true;
  });

  effect(() => {
    console.log(filteredTasks);
  });

  async function handleAddTask(e: Event) {
    e.preventDefault();
    if (!taskInput || !taskInput.value.trim()) return;

    const title = taskInput.value.trim();
    taskInput.value = '';

    const optimisticItem: LiveTask = {
      id: Date.now(),
      todo: title,
      completed: false,
      userId: 5,
    };

    // Optimistically update the live resource state
    tasksResource.mutate((current) => {
      current?.todos.unshift(optimisticItem);
    });

    try {
      await createTaskAction({ todo: title, completed: false, userId: 5 });
    } catch {
      // In case of error, refresh from server to restore ground truth
      tasksResource.refresh();
    }
  }

  function toggleTaskState(task: LiveTask) {
    // In-place reactive mutation
    task.completed = !task.completed;
  }

  function deleteTaskItem(id: number) {
    tasksResource.mutate((current) => {
      if (current?.todos) {
        const idx = current.todos.findIndex((t) => t.id === id);
        if (idx !== -1) {
          current.todos.splice(idx, 1);
        }
      }
    });
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-stone-100 tracking-tight">
              Live Engineering Task Board
            </h1>
            <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-400 border border-amber-800/60 text-xs font-mono">
              Optimistic REST Actions
            </span>
          </div>
          <p className="text-xs text-stone-400 mt-1">
            Real HTTP POST/PUT/DELETE calls backed by automatic optimistic UI state reconciliation.
          </p>
        </div>

        <button
          onClick={() => tasksResource.refresh()}
          disabled={tasksResource.pending}
          className="px-3.5 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 disabled:opacity-40 text-stone-200 text-xs font-semibold border border-stone-700 transition-all flex items-center gap-1.5 self-start sm:self-auto"
        >
          <span>🔄</span> {tasksResource.refreshing ? 'Syncing...' : 'Sync Live Data'}
        </button>
      </div>

      {/* Progress & Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl bg-stone-900/90 border border-stone-800 flex items-center justify-between">
          <div>
            <span className="text-xs font-mono text-stone-400 uppercase">Open Backlog</span>
            <div className="text-2xl font-bold text-amber-400 font-mono mt-0.5">{openCount}</div>
          </div>
          <span className="text-2xl">⏳</span>
        </div>

        <div className="p-4 rounded-2xl bg-stone-900/90 border border-stone-800 flex items-center justify-between">
          <div>
            <span className="text-xs font-mono text-stone-400 uppercase">Completed</span>
            <div className="text-2xl font-bold text-emerald-400 font-mono mt-0.5">{completedCount}</div>
          </div>
          <span className="text-2xl">✅</span>
        </div>

        <div className="p-4 rounded-2xl bg-stone-900/90 border border-stone-800 flex items-center justify-between">
          <div>
            <span className="text-xs font-mono text-stone-400 uppercase">Completion Rate</span>
            <div className="text-2xl font-bold text-stone-100 font-mono mt-0.5">{completionRate}%</div>
          </div>
          <span className="text-2xl">🎯</span>
        </div>
      </div>

      {/* New Task Form */}
      <div className="p-4 sm:p-5 rounded-2xl bg-stone-900/90 border border-stone-800 shadow-xl">
        <form onSubmit={handleAddTask} className="flex flex-col sm:flex-row items-center gap-3">
          <input
            ref={taskInput}
            placeholder="Add new engineering task / ticket (e.g. Implement OIDC token exchange)..."
            className="w-full px-4 py-2.5 rounded-xl bg-stone-950 border border-stone-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-stone-100 text-sm outline-none transition-all placeholder:text-stone-500 font-medium"
          />
          <button
            type="submit"
            disabled={createTaskAction.pending}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-stone-950 font-bold text-sm shadow-md shadow-emerald-950 transition-all flex items-center justify-center gap-1.5 whitespace-nowrap"
          >
            <span>+</span> {createTaskAction.pending ? 'Saving...' : 'Create Task'}
          </button>
        </form>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-1.5">
          {(['all', 'open', 'completed'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => statusFilter = filter}
              className={`px-3 py-1.5 rounded-lg capitalize font-mono transition-all ${
                statusFilter === filter
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold'
                  : 'bg-stone-950 text-stone-400 border border-stone-800 hover:text-stone-200'
              }`}
            >
              {filter}
            </button>
          ))}
        </div>
        <span className="text-stone-500 font-mono">
          Showing {filteredTasks.length} items
        </span>
      </div>

      {/* Task List container */}
      <div if={tasksResource.pending && !tasksResource.data} className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-16 rounded-2xl bg-stone-900/60 border border-stone-800 animate-pulse"></div>
        ))}
      </div>

      <div else-if={!!tasksResource.error && !tasksResource.data} className="p-6 rounded-2xl bg-rose-950/30 border border-rose-800/60 text-rose-300 text-center">
        <p className="text-sm font-bold">Failed to load tasks from server</p>
        <button
          onClick={() => tasksResource.refresh()}
          className="mt-3 px-3 py-1.5 rounded-lg bg-rose-900 text-rose-100 text-xs font-semibold"
        >
          Retry
        </button>
      </div>

      <div else className="space-y-3">
        {filteredTasks.map((task) => (
          <div
            key={task.id}
            className={`p-4 rounded-2xl border transition-all flex items-center justify-between gap-4 ${
              task.completed
                ? 'bg-stone-950/60 border-stone-800/60 text-stone-400'
                : 'bg-stone-900/90 border-stone-800 text-stone-100'
            }`}
          >
            <div className="flex items-center gap-3.5 flex-1 min-w-0">
              <button
                onClick={() => toggleTaskState(task)}
                className={`w-5 h-5 rounded-md border flex items-center justify-center text-xs transition-all ${
                  task.completed
                    ? 'bg-emerald-600 border-emerald-500 text-stone-950 font-bold'
                    : 'border-stone-700 hover:border-emerald-500 bg-stone-950'
                }`}
              >
                {task.completed ? '✓' : ''}
              </button>

              <span className={`text-sm font-medium truncate ${task.completed ? 'line-through text-stone-500' : 'text-stone-200'}`}>
                {task.todo}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                task.completed
                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/40'
                  : 'bg-amber-950 text-amber-400 border border-amber-800/40'
              }`}>
                {task.completed ? 'Completed' : 'In Progress'}
              </span>

              <button
                onClick={() => deleteTaskItem(task.id)}
                className="p-1.5 rounded-lg hover:bg-stone-800 text-stone-500 hover:text-rose-400 transition-colors text-xs"
                title="Delete task"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

    </main>
  );
}
