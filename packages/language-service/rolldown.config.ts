import { isAbsolute } from 'node:path';
import { defineConfig } from 'rolldown';

export default defineConfig({
  input: './src/index.ts',
  platform: 'node',
  transform: { target: 'node24' },
  external: (id) => !id.startsWith('.') && !isAbsolute(id),
  output: {
    file: './dist/index.cjs',
    format: 'cjs',
    minify: true,
  },
});
