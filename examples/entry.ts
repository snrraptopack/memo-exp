/**
 * @file entry.ts
 * Browser entry point for the Music Player example.
 */
import { MusicApp } from './music/MusicApp';

const rootElement = document.getElementById('root');
if (rootElement) {
  const factory = MusicApp as unknown as (
    id: string,
    parent: string | null,
  ) => Node;
  const appNode = factory('MusicApp', null);
  rootElement.appendChild(appNode);
}
