/** Build the representative browser graph measured by the size benchmark. */
import { resolve } from 'node:path';
import memoizedDom from '@memoized-dom/vite';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '../..');

await build({
  configFile: false,
  root: resolve(root, 'examples/todo'),
  plugins: [memoizedDom({ clientEntry: 'main.ts' })],
  build: {
    emptyOutDir: true,
    outDir: resolve(root, 'bench/package-size/dist'),
  },
});
