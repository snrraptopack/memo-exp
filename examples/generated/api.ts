// @ts-nocheck
/**
 * Generated from examples/api.ts; rebuild with bun run examples/build-todo.ts.
 */
import * as _MD from "../../src/runtime";
const _WRITES_ = ["/examples/db.ts#completedSet", "/examples/db.ts#state.isLoading", "/examples/db.ts#state.statusMessage", "/examples/db.ts#todos"];
const _WRITES_2 = ["/examples/db.ts#todos"];
const _WRITES_3 = ["/examples/db.ts#completedSet"];
import { todos, completedSet, state } from './db';
export async function fetchRemoteTodos() {
  state.isLoading = true;
  state.statusMessage = 'Fetching 10 live todos from JSONPlaceholder API...';
  try {
    const res = await fetch('https://jsonplaceholder.typicode.com/todos?_limit=10');
    const data = await res.json();

    // Re-populate todos
    todos.length = 0;
    data.forEach(item => {
      todos.push({
        id: item.id + 100,
        text: item.title
      });
      _MD.commitWrites(_WRITES_2);
    });
    completedSet.clear();
    data.forEach(item => {
      if (item.completed) completedSet.add(item.id + 100);
      _MD.commitWrites(_WRITES_3);
    });
    state.statusMessage = 'Successfully loaded remote API todos!';
  } catch (err) {
    state.statusMessage = 'Failed to fetch remote todos!';
  } finally {
    state.isLoading = false;
  }
  _MD.commitWrites(_WRITES_);
}
