/**
 * SSR showcase — fullstack Vite config.
 *
 * One plugin owns the client graph, server graph, SSR request boundary, and
 * HMR while Vite continues serving modules and CSS.
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
