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

/**
 * memo.mount(id,app) where the id will be the id that will be document.getElementById(id) behind the scene and the intial or the parent id
 * we are not going the react and co way of mounting app liike createRoot(<RefsApp/>) because later we can effectively
 * add ssr layer here and make better improvement
 */
