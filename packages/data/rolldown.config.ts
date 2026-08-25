import { isAbsolute } from 'node:path';
import { defineConfig } from 'rolldown';

export default defineConfig({
  input: {
    index: './src/index.ts',
    internal: './src/internal.ts',
  },
  platform: 'neutral',
  transform: { target: 'es2022' },
  // The runtime kernel must stay external: bundling a second copy would
  // duplicate module-level kernel state (active application runtime,
  // extension stores) and silently break per-runtime request isolation.
  // Bare specifiers are external; resolved ids arrive as absolute Windows
  // paths, so isAbsolute() is required instead of a leading-slash check.
  external: (id) => !id.startsWith('.') && !isAbsolute(id),
  output: {
    dir: './dist',
    format: 'esm',
    minify: true,
    entryFileNames: '[name].js',
    chunkFileNames: 'chunks/[name]-[hash].js',
  },
});
