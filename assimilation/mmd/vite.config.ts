import { defineConfig } from 'vite';
import memoizedDom from '@memoized-dom/vite';

export default defineConfig({
  root: import.meta.dirname,
  server: { port: 5174 },
  plugins: [
    memoizedDom({ clientEntry: 'src/main.ts' }),
  ],
});
