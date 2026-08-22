import { defineConfig } from 'vite';
import memoizedDom from '@memoized-dom/vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  server: {
    forwardConsole: true,
  },
  plugins: [
    tailwindcss(),
    memoizedDom({
      entries: 'src/main.ts',
    }),
  ],
});
