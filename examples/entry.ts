/**
 * @file entry.ts
 * Browser entry point for the Todo App.
 */
import { TodoApp } from './todo';

const rootElement = document.getElementById('root');
if (rootElement) {
  const factory = TodoApp as unknown as (
    id: string,
    parent: string | null,
  ) => Node;
  const appNode = factory('TodoApp', null);
  rootElement.appendChild(appNode);
}
