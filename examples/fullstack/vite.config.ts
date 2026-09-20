/**
 * Fullstack demo — Vite config.
 *
 * One plugin owns the client graph, server graph, generated server-function
 * facade, and HMR-safe request dispatch.
 */
import { defineConfig } from 'vite';
import memoizedDom from '@memoized-dom/vite';

export default defineConfig({
  root: import.meta.dirname,
  appType: 'custom',
  plugins: [memoizedDom({
    clientEntry: 'main.ts',
    serverEntry: 'server.ts',
    server: 'server',
  })],
});
