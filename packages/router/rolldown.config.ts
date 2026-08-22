import { defineConfig } from 'rolldown';

export default defineConfig({
  input: {
    index: './src/index.ts',
    internal: './src/internal.ts',
  },
  platform: 'browser',
  transform: { target: 'es2022' },
  output: {
    dir: './dist',
    format: 'esm',
    minify: true,
    entryFileNames: '[name].js',
    chunkFileNames: 'chunks/[name]-[hash].js',
  },
});
