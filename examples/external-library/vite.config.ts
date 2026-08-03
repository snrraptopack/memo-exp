import { defineConfig } from 'vite';
import memoizedDom from '@memoized-dom/vite';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    memoizedDom({
      entries: 'entry.ts',
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
