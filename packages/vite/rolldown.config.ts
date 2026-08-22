import { isAbsolute } from 'node:path';
import { defineConfig } from 'rolldown';

export default defineConfig({
  input: './src/index.ts',
  platform: 'browser',
  transform: { target: 'node24' },
  external: (id) => !id.startsWith('.') && !isAbsolute(id),
  output: {
    dir: './dist',
    entryFileNames: 'index.js',
    chunkFileNames: 'chunks/[name]-[hash].js',
    format: 'esm',
    minify: true,
  },
});
