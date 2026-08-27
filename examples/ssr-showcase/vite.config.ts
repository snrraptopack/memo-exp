/**
 * SSR showcase — fullstack Vite config.
 *
 * Two plugins, each owning one half of the stack:
 * - `memoizedDom` compiles the client graph (module sources, HMR).
 * - `memoizedDomFullstack` installs the post-Vite Web-handler boundary so
 *   document requests are server-rendered by `server.ts` while Vite keeps
 *   serving modules, CSS, and hot updates untouched.
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
