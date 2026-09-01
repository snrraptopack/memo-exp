import type { ColumnData, Priority, Task } from './types';

export let nextTaskId = 10;
export let searchQuery = '';
export let selectedCategory = 'All';

export const columns: ColumnData[] = [
  {
    id: 'todo',
    title: 'To Do',
    tasks: [
      { id: 1, title: 'Define ESTree types without Babel', category: 'Frontend', priority: 'high', completed: false },
      { id: 2, title: 'Benchmark pluggable ESTree frontends', category: 'DevOps', priority: 'medium', completed: false },
      { id: 3, title: 'Implement TSRX statement containers', category: 'Frontend', priority: 'low', completed: false },
    ],
  },
  {
    id: 'inprogress',
    title: 'In Progress',
    tasks: [
      { id: 4, title: 'Extract scoped CSS into virtual Vite module', category: 'Backend', priority: 'high', completed: false },
      { id: 5, title: 'Audit zero `as any` type assertions', category: 'Frontend', priority: 'medium', completed: false },
    ],
  },
  {
    id: 'done',
    title: 'Completed',
    tasks: [
      { id: 6, title: 'Decouple Access Table from NodePath', category: 'Backend', priority: 'high', completed: true },
      { id: 7, title: 'Support multi-file TSRX component imports', category: 'Frontend', priority: 'medium', completed: true },
    ],
  },
];

export function setSearchQuery(q: string) {
  searchQuery = q;
}

export function setSelectedCategory(cat: string) {
  selectedCategory = cat;
}

export function addTask(column: ColumnData, title: string, category: string, priority: Priority) {
  column.tasks.push({
    id: nextTaskId++,
    title,
    category,
    priority,
    completed: column.id === 'done',
  });
}

export function removeTask(column: ColumnData, taskId: number) {
  const index = column.tasks.findIndex((t) => t.id === taskId);
  if (index !== -1) {
    column.tasks.splice(index, 1);
  }
}

export function toggleTask(task: Task) {
  task.completed = !task.completed;
}
