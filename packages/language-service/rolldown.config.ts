import { isAbsolute } from 'node:path';
import { defineConfig } from 'rolldown';

const external = (id: string) => !id.startsWith('.') && !isAbsolute(id);

export default defineConfig({
  input: './src/index.ts',
  platform: 'node',
  transform: { target: 'node24' },
  external,
  output: {
    file: './dist/index.cjs',
    format: 'cjs',
    minify: true,
  },
});
