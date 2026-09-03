import { isAbsolute } from 'node:path';
import { defineConfig } from 'rolldown';

export default defineConfig({
  input: {
    index: './src/index.ts',
    'http-router': './src/http-router.ts',
  },
  platform: 'node',
  transform: { target: 'node24' },
  external: (id) => !id.startsWith('.') && !isAbsolute(id),
  output: {
    dir: './dist',
    format: 'esm',
    minify: true,
    entryFileNames: '[name].js',
    chunkFileNames: 'chunks/[name]-[hash].js',
  },
});
