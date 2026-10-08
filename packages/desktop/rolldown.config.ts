import { isAbsolute } from 'node:path';
import { defineConfig } from 'rolldown';

export default defineConfig({
  input: { index: './src/index.ts', host: './src/bridge/process.ts' },
  platform: 'neutral',
  transform: { target: 'es2022' },
  external: id => !id.startsWith('.') && !isAbsolute(id),
  output: { dir: './dist', format: 'esm', entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js' },
});
