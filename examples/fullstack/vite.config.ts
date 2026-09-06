/**
 * Fullstack demo — Vite config.
 *
 * - `memoizedDom` compiles the client graph and generates the
 *   `#server-functions` facade barrel plus `.memoized/` artifacts.
 * - `memoizedDomFullstack` loads `server.ts` through ssrLoadModule and
 *   installs the generated server-function routes per dispatch (HMR-safe).
 */
import { defineConfig } from 'vite';
import memoizedDom, { memoizedDomFullstack } from '@memoized-dom/vite';

export default defineConfig({
  root: import.meta.dirname,
  appType: 'custom',
  plugins: [
    memoizedDom({ entries: 'main.ts' }),
    memoizedDomFullstack({ entry: 'server.ts' }),
  ],
});
