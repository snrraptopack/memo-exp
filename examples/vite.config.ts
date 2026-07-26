/**
 * Builds the authored todo graph through the public memoized-dom Vite adapter.
 */
import { defineConfig } from 'vite';
import memoizedDom from '@memoized-dom/vite';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    memoizedDom({
      entries: 'CartApp.tsx',
      rootId: 'CartApp',
    }),
  ],
});
