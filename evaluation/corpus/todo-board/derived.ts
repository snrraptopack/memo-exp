import { board } from './state';

export const total = board.todos.length;
export const completed = board.todos.filter((todo) => todo.done).length;
export const remaining = total - completed;
