/**
 * @file entry.ts
 * Browser entry point for the Kanban Board example.
 */
import { KanbanApp } from './kanban/KanbanApp';

const rootElement = document.getElementById('root');
if (rootElement) {
  const factory = KanbanApp as unknown as (
    id: string,
    parent: string | null,
  ) => Node;
  const appNode = factory('KanbanApp', null);
  rootElement.appendChild(appNode);
}
