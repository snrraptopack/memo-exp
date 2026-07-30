/**
 * @file entry.ts
 * Browser entry point for the DOM Ref Laboratory example.
 */
import { RefsApp } from './refs/RefsApp';
import './refs/styles.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  const factory = RefsApp as unknown as (
    id: string,
    parent: string | null,
  ) => Node;
  const appNode = factory('RefsApp', null);
  rootElement.appendChild(appNode);
}
