interface Task {
  id: number;
  text: string;
  done: boolean;
}

export function App() {
  const tasks: Task[] = [];
  let newTask = '';

  function addTask(e: Event) {
    e.preventDefault();
    if (newTask.trim() === '') return;
    tasks.push({ id: Date.now(), text: newTask.trim(), done: false });
    newTask = '';
  }

  function toggleTask(id: number) {
    const task = tasks.find((candidate) => candidate.id === id);
    if (task) {
      task.done = !task.done;
    }
  }

  function deleteTask(id: number) {
    const index = tasks.findIndex((candidate) => candidate.id === id);
    if (index !== -1) {
      tasks.splice(index, 1);
    }
  }

  return (
    <>
      <h1>Simple TODO List</h1>
      <form onSubmit={addTask}>
        <input
          type="text"
          value={newTask}
          onInput={(event) => {
            newTask = (event.target as HTMLInputElement).value;
          }}
          placeholder="Add a new task..."
        />
        <button type="submit">Add</button>
      </form>
      {tasks.length === 0 ? (
        <p>No tasks yet. Add one above!</p>
      ) : (
        <ul>
          {tasks.map((task) => (
            <li key={task.id}>
              <input
                type="checkbox"
                checked={task.done}
                onChange={() => toggleTask(task.id)}
              />
              <span
                style={{
                  textDecoration: task.done ? 'line-through' : 'none',
                  color: task.done ? 'gray' : 'inherit',
                }}
              >
                {task.text}
              </span>
              <button onClick={() => deleteTask(task.id)}>Delete</button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
