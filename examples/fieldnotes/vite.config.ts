import { defineConfig } from 'vite';
import memoizedDom from '@memoized-dom/vite';

export default defineConfig({
  root: import.meta.dirname,
  appType: 'custom',
  plugins: [
    memoizedDom({
      clientEntry: 'main.ts',
      serverEntry: 'server.ts',
      server: 'server',
    }),
  ],
});
