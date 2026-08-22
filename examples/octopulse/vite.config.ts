import { defineConfig } from 'vite';
import memoizedDom from '@memoized-dom/vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
    memoizedDom({
      entries: 'src/main.ts',
    }),
  ],
});
