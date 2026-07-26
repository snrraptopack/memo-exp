/**
 * @file entry.ts
 * Browser entry point for the E-Commerce Cart App example.
 */
import { CartApp } from './CartApp';

const rootElement = document.getElementById('root');
if (rootElement) {
  const factory = CartApp as unknown as (
    id: string,
    parent: string | null,
  ) => Node;
  const appNode = factory('CartApp', null);
  rootElement.appendChild(appNode);
}
