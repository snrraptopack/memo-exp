import type {} from '@memoized-dom/compiler/jsx';
import { TodoRow } from './TodoRow';
import './todo.css';

export function TodoApp() {
  let tasks = [
    { id: 1, title: 'Type a task and add it to the list', done: false },
    { id: 2, title: 'Complete a task, then undo it', done: false },
    { id: 3, title: 'Reverse the list and check that row notes stay with their task', done: true },
  ];
  let nextId = 4;
  let draft = '';
  let filter = 'all';
  let message = 'Ready. Add your first task below.';
  let lastKey = '';
  const add = (event: SubmitEvent) => {
    event.preventDefault();
    if (!draft.trim()) {
      message = 'Write a task before adding it.';
      return;
    }
    tasks = [{ id: nextId++, title: draft.trim(), done: false }, ...tasks];
    draft = '';
    message = 'Task added at the top of the list.';
  };
  const toggle = (id: number) => {
    tasks = tasks.map((task) => (task.id === id ? { ...task, done: !task.done } : task));
    message = 'Task updated.';
  };
  const remove = (id: number) => {
    tasks = tasks.filter((task) => task.id !== id);
    message = 'Task deleted.';
  };
  const handleDraftKey = (event: KeyboardEvent) => {
    lastKey = event.key;
    const keepDraft = event.key === 'Enter' && event.shiftKey;
    const keepFocus = event.key === 'Tab' && event.ctrlKey;
    if (keepDraft || keepFocus) event.preventDefault();
  };
  const reverseTasks = () => {
    // The key remains the task ID, so local row notes survive this movement.
    tasks = tasks.toReversed();
    message = 'Task order reversed.';
  };
  const clearCompleted = () => {
    tasks = tasks.filter((task) => !task.done);
    message = 'Completed tasks cleared.';
  };
  const addSamples = () => {
    const samples = Array.from({ length: 20 }, () => {
      const id = nextId++;
      return { id, title: 'Scroll test task ' + id, done: false };
    });
    tasks = [...tasks, ...samples];
    message = 'Added 20 tasks. Scroll down to reach the last one.';
  };

  return (
    <div id="todo-page" class="todo-page">
      <main id="todo-workspace" class="workspace">
        <header class="hero">
          <p class="eyebrow">MEMOIZED DOM DESKTOP</p>
          <h1>Your day, one task at a time.</h1>
          <p class="subtitle">
            A small workspace for testing native typing, clicks, lists, and CSS layout.
          </p>
        </header>
        <section id="todo-stats" class="stats">
          <div id="stat-total" class="stat">
            <p class="stat-label">Total tasks</p>
            <p id="total-count" class="stat-value">
              {tasks.length}
            </p>
          </div>
          <div id="stat-active" class="stat">
            <p class="stat-label">Still to do</p>
            <p id="active-count" class="stat-value">
              {tasks.filter((task) => !task.done).length}
            </p>
          </div>
          <div id="stat-done" class="stat">
            <p class="stat-label">Completed</p>
            <p id="done-count" class="stat-value">
              {tasks.filter((task) => task.done).length}
            </p>
          </div>
        </section>
        <form id="todo-form" class="panel composer" onSubmit={add}>
          <h2>Add a task</h2>
          <div id="todo-editor" class="editor">
            <input
              id="new-task"
              type="text"
              placeholder="What would you like to do?"
              value={draft}
              onInput={(event) => (draft = event.currentTarget.value)}
              onKeyDown={handleDraftKey}
            />
            <button id="add-task" type="submit" class="primary">
              Add task
            </button>
          </div>
          <p id="draft-preview" class="muted">
            Typing: {draft}
          </p>
          <p id="todo-message" class="message">
            {message}
          </p>
          <p id="last-key" class="muted">
            Last key: {lastKey}
          </p>
          <p class="muted">
            Enter adds your task. Shift+Enter keeps your draft. Tab moves focus; Ctrl+Tab keeps
            focus here.
          </p>
        </form>
        <section class="panel tasks-panel">
          <div class="toolbar">
            <h2>Your tasks</h2>
            <div class="button-group">
              <button id="filter-all" onClick={() => (filter = 'all')}>
                All
              </button>
              <button id="filter-active" onClick={() => (filter = 'active')}>
                Active
              </button>
              <button id="filter-done" onClick={() => (filter = 'done')}>
                Completed
              </button>
            </div>
          </div>
          <p id="filter-summary" class="muted">
            Showing: {filter}
          </p>
          <div class="button-group utilities">
            <button id="reverse-tasks" onClick={reverseTasks}>
              Reverse order
            </button>
            <button id="clear-done" onClick={clearCompleted}>
              Clear completed
            </button>
            <button id="add-samples" onClick={addSamples}>
              Add 20 test tasks
            </button>
          </div>
          {tasks.length === 0 && (
            <div id="empty-tasks" class="empty">
              <h2>A clear list.</h2>
              <p>Add a task above to start again.</p>
            </div>
          )}
          <div id="task-list" class="task-list">
            {tasks
              .filter((task) => filter === 'all' || (filter === 'done' ? task.done : !task.done))
              .map((task) => (
                <article key={task.id} class="task-row">
                  <TodoRow
                    id={task.id}
                    title={task.title}
                    done={task.done}
                    onToggle={toggle}
                    onDelete={remove}
                    onReverse={reverseTasks}
                  />
                </article>
              ))}
          </div>
        </section>
        <footer id="todo-footer">
          <p class="muted">
            Type a row note, then press Ctrl+R to reverse the list. Its note and focus should
            follow the task.
          </p>
        </footer>
      </main>
    </div>
  );
}
