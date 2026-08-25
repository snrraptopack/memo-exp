/**
 * Builds the authored refs graph through the public memoized-dom Vite adapter.
 */
import { defineConfig } from 'vite';
import memoizedDom from '@memoized-dom/vite';

export default defineConfig({
  root: import.meta.dirname,
  server: {
    forwardConsole: true,
  },
  plugins: [
    memoizedDom({
      // Select an example graph without editing this file:
      //   MMD_EXAMPLE=workspace/main.ts bun run example:workspace
      // Defaults to the workspace example; each example also serves its own
      // graph when visited directly (e.g. /hacker-news/).
      entries: process.env.MMD_EXAMPLE ?? 'workspace/main.ts',
    }),
  ],
});
