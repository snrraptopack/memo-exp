import { createDataRuntime } from '@memoized-dom/data';
import { mockFetch, TaskListSchema } from './mock-server';
import type { Task, TaskPriority, TaskStatus, CreateTaskInput } from './types';
import { TaskCard } from './TaskCard';
import { ControlPanel } from './ControlPanel';
import { DiagnosticsPanel } from './DiagnosticsPanel';

export function DataReactivityApp() {
  const dataRuntime = createDataRuntime({
    fetch: mockFetch as typeof fetch,
  });
  const previousStatuses = new Map<string, TaskStatus>();
  const deletedTasks = new Map<string, { task: Task; index: number }>();
  let isCreating = false;
  const createTaskAction = dataRuntime.$action<Task, CreateTaskInput>('/api/tasks', {
    method: 'POST',
    onSuccess(result, input) {
      tasksResource.mutate(items => {
        const index = items?.findIndex(
          item => item.isOptimistic && item.title === input.title,
        ) ?? -1;
        if (items && index >= 0) items[index] = result;
      });
      actionNotification = '✓ Task created and committed successfully by server!';
      isCreating = false;
    },
    onError(error, input) {
      tasksResource.mutate(items => {
        const index = items?.findIndex(
          item => item.isOptimistic && item.title === input.title,
        ) ?? -1;
        if (items && index >= 0) items.splice(index, 1);
      });
      actionNotification = `❌ Server Error: Optimistic creation rolled back! (${error.message})`;
      isCreating = false;
    },
  });
  const updateTaskAction = dataRuntime.$action<Task, { id: string; status: TaskStatus }>('/api/tasks/update', {
    method: 'PATCH',
    onSuccess(result, input) {
      tasksResource.mutate(items => {
        const index = items?.findIndex(item => item.id === input.id) ?? -1;
        if (items && index >= 0) items[index] = result;
      });
      previousStatuses.delete(input.id);
      actionNotification = '✓ Task status updated on server!';
    },
    onError(_error, input) {
      const previous = previousStatuses.get(input.id);
      const task = tasksResource.data?.find(item => item.id === input.id);
      if (task && previous) task.status = previous;
      previousStatuses.delete(input.id);
      actionNotification = '❌ Server Error: Status update rolled back!';
    },
  });
  const deleteTaskAction = dataRuntime.$action<void, { id: string }>('/api/tasks/delete', {
    method: 'DELETE',
    onSuccess(_result, input) {
      deletedTasks.delete(input.id);
      actionNotification = '✓ Task deleted on server!';
    },
    onError(_error, input) {
      const deleted = deletedTasks.get(input.id);
      if (deleted) {
        tasksResource.mutate(items => items?.splice(deleted.index, 0, deleted.task));
      }
      deletedTasks.delete(input.id);
      actionNotification = '❌ Server Error: Deleted task restored to list!';
    },
  });
  let statusFilter: TaskStatus | 'all' = 'all';
  let searchQuery = '';
  let newTitle = '';
  let newDescription = '';
  let newPriority: TaskPriority = 'medium';
  let newCategory = 'Engineering';
  let actionNotification = '';

  function loadTasks() {
    return dataRuntime.$fetch('/api/tasks', {
      query: {
        status: statusFilter,
        search: searchQuery,
      },
      validate: TaskListSchema,
    });
  }

  let tasksResource = loadTasks();
  cleanup(dataRuntime.clear);

  function replaceTasksResource() {
    const previous = tasksResource;
    tasksResource = loadTasks();
    previous.abort();
  }

  function handleCreateTask(e: Event) {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const tempTask: Task = {
      id: `temp-${Date.now()}`,
      title: newTitle.trim(),
      description: newDescription.trim(),
      priority: newPriority,
      category: newCategory,
      status: 'todo',
      createdAt: new Date().toISOString(),
      isOptimistic: true,
    };

    const inputData: CreateTaskInput = {
      title: newTitle.trim(),
      description: newDescription.trim(),
      priority: newPriority,
      category: newCategory,
    };

    newTitle = '';
    newDescription = '';

    actionNotification = '⚡ Submitting task with optimistic UI list insertion...';
    isCreating = true;
    tasksResource.mutate(items => items?.push(tempTask));
    const creation = createTaskAction(inputData);
    void creation;
  }

  function handleUpdateStatus(task: Task, nextStatus: TaskStatus) {
    previousStatuses.set(task.id, task.status);
    task.status = nextStatus;
    task.isOptimistic = true;
    actionNotification = `⚡ Updating task status optimistically to ${nextStatus.toUpperCase()}...`;
    const update = updateTaskAction({ id: task.id, status: nextStatus });
    void update;
  }

  function handleDeleteTask(task: Task) {
    actionNotification = '⚡ Removing task optimistically...';
    tasksResource.mutate(items => {
      const index = items?.indexOf(task) ?? -1;
      if (items && index >= 0) {
        deletedTasks.set(task.id, { task, index });
        items.splice(index, 1);
      }
    });
    const deletion = deleteTaskAction({ id: task.id });
    void deletion;
  }

  function handleRefresh() {
    actionNotification = '🔄 Initiating manual resource.refresh()...';
    tasksResource.refresh();
  }

  function handleAbort() {
    actionNotification = '🛑 Active resource.abort() triggered.';
    tasksResource.abort();
  }

  function handleClearCache() {
    actionNotification = '🧹 Application store cache cleared.';
    dataRuntime.clear();
    tasksResource.refresh();
  }

  let configTick = 0;
  function handleConfigChange(): void {
    configTick++;
  }

  return (
    <main class="data-app">
      {/* Sleek Modern Header */}
      <header class="app-header">
        <div class="header-content">
          <div class="brand">
            <span class="brand-badge">MEMOIZED DOM DATA LAYER</span>
            <h1>Sprint Command & Data Reactivity Studio</h1>
            <p class="subtitle">
              High-performance data management powered by <code>$fetch</code>, <code>$action</code>, optimistic UI collection mutations, and schema validation.
            </p>
          </div>
          <div class="header-meta">
            <span class="tech-tag">Standard Schema V1</span>
            <span class="tech-tag">Dirty Routing</span>
            <span class="tech-tag">Optimistic Collection Engine</span>
            <span class="tech-tag">Sim Revisions: {configTick}</span>
          </div>
        </div>
      </header>

      {/* Simulator Control Panel */}
      <ControlPanel
        onRefresh={handleRefresh}
        onAbort={handleAbort}
        onClearCache={handleClearCache}
        onConfigChange={handleConfigChange}
      />

      {/* Main Grid Layout */}
      <div class="app-layout">
        {/* Left Column: Tasks Feed & Controls */}
        <section class="main-content">
          {/* Action Notification Toast */}
          {actionNotification && (
            <div class="notification-toast">
              <span>{actionNotification}</span>
              <button
                aria-label="Dismiss notification"
                onClick={() => { actionNotification = ''; }}
              >✕</button>
            </div>
          )}

          {/* Search and Category Filter Toolbar */}
          <div class="toolbar">
            <div class="search-box">
              <span class="search-icon">🔍</span>
              <input
                type="text"
                placeholder="Search tasks, categories, or keywords..."
                value={searchQuery}
                onInput={(e: Event) => {
                  searchQuery = (e.target as HTMLInputElement).value;
                  replaceTasksResource();
                }}
              />
              {searchQuery && (
                <button
                  class="clear-search"
                  aria-label="Clear search"
                  onClick={() => {
                    searchQuery = '';
                    replaceTasksResource();
                  }}
                >
                  ✕
                </button>
              )}
            </div>

            <div class="filter-tabs">
              {(['all', 'todo', 'in_progress', 'done'] as const).map((status) => (
                <button
                  class={`tab-item ${statusFilter === status ? 'active' : ''}`}
                  onClick={() => {
                    statusFilter = status;
                    replaceTasksResource();
                  }}
                >
                  {status === 'all' ? 'All Tasks' : status.replace('_', ' ').toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Task Creation Form */}
          <form class="create-task-card" onSubmit={handleCreateTask}>
            <div class="form-title-row">
              <h3>✨ Add New Sprint Task</h3>
              <span class="form-hint">Tests `$action` with ordinary optimistic data writes</span>
            </div>

            <div class="form-inputs-grid">
              <input
                type="text"
                class="input-title"
                placeholder="Task title (e.g., Implement virtual list slot)..."
                value={newTitle}
                onInput={(e: Event) => { newTitle = (e.target as HTMLInputElement).value; }}
                required
              />

              <div class="form-selects">
                <select
                  value={newPriority}
                  onChange={(e: Event) => { newPriority = (e.target as HTMLSelectElement).value as TaskPriority; }}
                >
                  <option value="low">Priority: Low</option>
                  <option value="medium">Priority: Medium</option>
                  <option value="high">Priority: High</option>
                  <option value="critical">Priority: Critical</option>
                </select>

                <select
                  value={newCategory}
                  onChange={(e: Event) => { newCategory = (e.target as HTMLSelectElement).value; }}
                >
                  <option value="Core Runtime">Core Runtime</option>
                  <option value="Data Layer">Data Layer</option>
                  <option value="Compiler">Compiler</option>
                  <option value="Testing">Testing</option>
                </select>
              </div>
            </div>

            <textarea
              class="input-desc"
              placeholder="Task details and reactive requirements..."
              rows={2}
              value={newDescription}
              onInput={(e: Event) => { newDescription = (e.target as HTMLTextAreaElement).value; }}
            ></textarea>

            <div class="form-actions">
              <button
                type="submit"
                class="btn-submit-task"
                disabled={isCreating}
              >
                {isCreating ? '⚡ Sending Request...' : '➕ Create Task (Optimistic)'}
              </button>
            </div>
          </form>

          {/* Task List Header */}
          <div class="list-status-header">
            <h2>
              Task Stream
              {tasksResource.refreshing && <span class="refreshing-badge">⚡ Refreshing...</span>}
            </h2>
            <span class="count-badge">
              {tasksResource.data?.length ?? 0} tasks visible
            </span>
          </div>

          {/* Loading, Empty, and Task List rendering */}
          {tasksResource.pending && !tasksResource.data && (
            <div class="loading-skeleton">
              <div class="skeleton-card"></div>
              <div class="skeleton-card"></div>
            </div>
          )}

          {!tasksResource.pending && tasksResource.data?.length === 0 && (
            <div class="empty-state">
              <p>No tasks match the selected criteria.</p>
              <button onClick={() => {
                statusFilter = 'all';
                searchQuery = '';
                replaceTasksResource();
              }}>
                Reset Filters
              </button>
            </div>
          )}

          <div class="tasks-grid">
            {tasksResource.data?.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onUpdateStatus={handleUpdateStatus}
                onDelete={handleDeleteTask}
              />
            ))}
          </div>
        </section>

        {/* Right Column: Diagnostics & Inspector */}
        <section class="sidebar">
          <DiagnosticsPanel resource={tasksResource} />
        </section>
      </div>
    </main>
  );
}
