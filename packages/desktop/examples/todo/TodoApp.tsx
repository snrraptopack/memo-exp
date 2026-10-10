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
  const toggle = (id: number) => {
    tasks = tasks.map(task => task.id === id ? { ...task, done: !task.done } : task);
    message = 'Task updated.';
  };
  const remove = (id: number) => {
    tasks = tasks.filter(task => task.id !== id);
    message = 'Task deleted.';
  };

  return <div id="todo-page" class="todo-page">
    <main id="todo-workspace" class="workspace">
      <header class="hero">
        <p class="eyebrow">MEMOIZED DOM DESKTOP</p>
        <h1>Your day, one task at a time.</h1>
        <p class="subtitle">A small workspace for testing native typing, clicks, lists, and CSS layout.</p>
      </header>
      <section id="todo-stats" class="stats">
        <div id="stat-total" class="stat"><p class="stat-label">Total tasks</p><p id="total-count" class="stat-value">{tasks.length}</p></div>
        <div id="stat-active" class="stat"><p class="stat-label">Still to do</p><p id="active-count" class="stat-value">{tasks.filter(task => !task.done).length}</p></div>
        <div id="stat-done" class="stat"><p class="stat-label">Completed</p><p id="done-count" class="stat-value">{tasks.filter(task => task.done).length}</p></div>
      </section>
      <section class="panel composer">
        <h2>Add a task</h2>
        <div id="todo-editor" class="editor">
          <input id="new-task" type="text" placeholder="What would you like to do?" value={draft}
            onInput={event => draft = event.currentTarget.value} />
          <button id="add-task" class="primary" onClick={() => {
            if (!draft.trim()) { message = 'Write a task before adding it.'; return; }
            tasks = [{ id: nextId++, title: draft.trim(), done: false }, ...tasks];
            draft = '';
            message = 'Task added at the top of the list.';
          }}>Add task</button>
        </div>
        <p id="draft-preview" class="muted">Typing: {draft}</p>
        <p id="todo-message" class="message">{message}</p>
      </section>
      <section class="panel tasks-panel">
        <div class="toolbar">
          <h2>Your tasks</h2>
          <div class="button-group">
            <button id="filter-all" onClick={() => filter = 'all'}>All</button>
            <button id="filter-active" onClick={() => filter = 'active'}>Active</button>
            <button id="filter-done" onClick={() => filter = 'done'}>Completed</button>
          </div>
        </div>
        <p id="filter-summary" class="muted">Showing: {filter}</p>
        <div class="button-group utilities">
          <button id="reverse-tasks" onClick={() => { tasks = tasks.toReversed(); message = 'Task order reversed.'; }}>Reverse order</button>
          <button id="clear-done" onClick={() => { tasks = tasks.filter(task => !task.done); message = 'Completed tasks cleared.'; }}>Clear completed</button>
          <button id="add-samples" onClick={() => {
            tasks = [...tasks, ...Array.from({ length: 20 }, () => ({ id: nextId++, title: 'Scroll test task ' + (nextId - 1), done: false }))];
            message = 'Added 20 tasks. Scroll down to reach the last one.';
          }}>Add 20 test tasks</button>
        </div>
        {tasks.length === 0 && <EmptyTasks />}
        <div id="task-list" class="task-list">
          {tasks.filter(task => filter === 'all' || (filter === 'done' ? task.done : !task.done)).map(task =>
            <TodoRow key={task.id} id={task.id} title={task.title} done={task.done} onToggle={toggle} onDelete={remove} />)}
        </div>
      </section>
      <footer id="todo-footer"><p class="muted">Try typing a note in a row, then reversing the list. Its note should follow the task.</p></footer>
    </main>
  </div>;
}

function EmptyTasks() {
  return <div id="empty-tasks" class="empty"><h2>A clear list.</h2><p>Add a task above to start again.</p></div>;
}
