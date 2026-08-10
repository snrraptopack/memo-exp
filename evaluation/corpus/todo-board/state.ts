export interface Todo { id: number; title: string; done: boolean }

export const board = {
  todos: [] as Todo[],
  filter: 'all' as 'all' | 'open' | 'done',
  nextId: 1,
};
