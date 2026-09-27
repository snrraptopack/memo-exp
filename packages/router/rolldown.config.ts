import { defineConfig } from 'rolldown';

export default defineConfig({
  input: {
    index: './src/index.ts',
    internal: './src/internal.ts',
  },
  platform: 'browser',
  // Share the application kernel with compiled components; a bundled copy
  // would collect readiness in a different runtime/extension store.
  external: id => id === '@memoized-dom/runtime' || id.startsWith('@memoized-dom/runtime/'),
  transform: { target: 'es2022' },
  output: {
    dir: './dist',
    format: 'esm',
    minify: true,
    entryFileNames: '[name].js',
    chunkFileNames: 'chunks/[name]-[hash].js',
  },
});
