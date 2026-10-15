/** Test-owned application: changes here intentionally change the Todo contract. */
import './style.css';
import { TodoRow } from './TodoRow';
import { addTask, clearCompleted, remainingTasks, reverseTasks, todoStore } from './state';

export function App() {
  return (
    <main class="todo-page">
      <section class="todo-card">
        <header class="todo-header">
          <span class="eyebrow">Memoized DOM · Desktop</span>
          <h1>Keep the small things moving.</h1>
          <p>Add a task, check it off, and make a little room for what comes next.</p>
        </header>

        <div class="todo-toolbar">
          <div>
            <strong class="remaining-count">{remainingTasks()} tasks left</strong>
            <p class="toolbar-hint">{todoStore.tasks.length} tasks in your list</p>
          </div>
          <button class="primary-button" data-action="add" onClick={addTask}>+ Add task</button>
        </div>

        <nav class="todo-filters" aria-label="Filter tasks">
          <button
            data-action="all"
            aria-pressed={todoStore.filter === 'all'}
            onClick={() => { todoStore.filter = 'all'; }}
          >
            All
          </button>
          <button
            data-action="active"
            aria-pressed={todoStore.filter === 'active'}
            onClick={() => { todoStore.filter = 'active'; }}
          >
            Active
          </button>
          <button
            data-action="completed"
            aria-pressed={todoStore.filter === 'completed'}
            onClick={() => { todoStore.filter = 'completed'; }}
          >
            Completed
          </button>
        </nav>

        <ul class="todo-list">
          {todoStore.tasks.map((todo, index) => <TodoRow key={todo.id} todo={todo} index={index} />)}
        </ul>

        {todoStore.tasks.length === 0 ? <p class="empty-state">A clear list. Add your next small step.</p> : null}

        <footer class="todo-footer">
          <div class="footer-actions">
            <button data-action="reverse" onClick={reverseTasks}>Reverse order</button>
            <button data-action="clear" onClick={clearCompleted}>Clear completed</button>
          </div>
          <p>New tasks receive numbered titles. Click a title to toggle its edited label.</p>
          <p>Increase a task’s click count, then reverse the list. The count follows that task.</p>
        </footer>
      </section>
    </main>
  );
}
