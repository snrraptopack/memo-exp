import { todos, completedSet, state } from './db';

export async function fetchRemoteTodos(): Promise<void> {
  state.isLoading = true;
  state.statusMessage = 'Fetching 10 live todos from JSONPlaceholder API...';

  try {
    const res = await fetch('https://jsonplaceholder.typicode.com/todos?_limit=10');
    const data = await res.json();

    // Re-populate todos
    todos.length = 0;
    data.forEach((item: any) => {
      todos.push({
        id: item.id + 100,
        text: item.title
      });
    });

    completedSet.clear();
    data.forEach((item: any) => {
      if (item.completed) completedSet.add(item.id + 100);
    });

    state.statusMessage = 'Successfully loaded remote API todos!';
  } catch (err) {
    state.statusMessage = 'Failed to fetch remote todos!';
  } finally {
    state.isLoading = false;
  }
}
