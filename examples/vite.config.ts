/**
 * Builds the authored wizard graph through the public memoized-dom Vite adapter.
 */
import { defineConfig } from 'vite';
import memoizedDom from '@memoized-dom/vite';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    memoizedDom({
      entries: 'music/MusicApp.tsx',
      rootId: 'MusicApp',
    }),
  ],
});
