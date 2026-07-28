/**
 * @file entry.ts
 * Browser entry point for the Real-Time System Dashboard example.
 */
import { DashboardApp } from './dashboard/DashboardApp';

const rootElement = document.getElementById('root');
if (rootElement) {
  const factory = DashboardApp as unknown as (
    id: string,
    parent: string | null,
  ) => Node;
  const appNode = factory('DashboardApp', null);
  rootElement.appendChild(appNode);
}
