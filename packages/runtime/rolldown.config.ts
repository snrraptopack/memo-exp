import { defineConfig } from 'rolldown';

export default defineConfig({
  input: {
    index: './src/index.ts',
    hot: './src/hot.ts',
    server: './src/server.ts',
    testing: './src/testing.ts',
  },
  external: ['node:async_hooks'],
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
