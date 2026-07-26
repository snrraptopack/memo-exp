export interface Todo {
  id: number;
  text: string;
}

// Exported array state
export let todos: Todo[] = [
  { id: 1, text: 'Master Cross-Module Memoized DOM State' },
  { id: 2, text: 'Test Multi-File Component Architecture' },
  { id: 3, text: 'Verify Cross-File API Services' }
];

// Exported state object for cross-module reactivity
export const state = {
  isLoading: false,
  statusMessage: 'Ready'
};

// Exported collections
export const completedSet = new Set<number>([1]);
export const categoryMap = new Map<number, string>([
  [1, 'Compiler'],
  [2, 'Network'],
  [3, 'Performance']
]);
