/**
 * @file entry.ts
 * Browser entry point for the Todo App.
 */
import { TodoApp } from './compiled-todo';

const rootElement = document.getElementById('root');
if (rootElement) {
  const appNode = TodoApp('TodoApp', null);
  rootElement.appendChild(appNode);
}
