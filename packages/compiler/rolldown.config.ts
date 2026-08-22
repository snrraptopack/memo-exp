import { isAbsolute } from 'node:path';
import { defineConfig } from 'rolldown';

export default defineConfig({
  input: './src/index.ts',
  platform: 'node',
  transform: { target: 'node24' },
  // Only bare specifiers (dependencies) are external. Resolved ids arrive as
  // absolute paths — on Windows those look like "C:/..." rather than "/...",
  // so isAbsolute() must be used instead of a leading-slash check, otherwise
  // every local module is treated as external and dist collapses into
  // re-exports of files that were never written.
  external: (id) => !id.startsWith('.') && !isAbsolute(id),
  output: {
    dir: './dist',
    format: 'esm',
    minify: true,
    entryFileNames: 'index.js',
    chunkFileNames: 'chunks/[name]-[hash].js',
  },
});
