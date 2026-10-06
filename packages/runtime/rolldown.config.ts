import { defineConfig } from 'rolldown';

export default defineConfig({
  input: {
    index: './src/index.ts',
    hot: './src/hot.ts',
    hydrate: './src/hydrate.ts',
    'hydrate-program': './src/hydrate-program.ts',
    server: './src/server.ts',
    testing: './src/testing.ts',
  },
  external: ['node:async_hooks'],
  platform: 'browser',
  transform: { target: 'es2022' },
  output: {
    dir: './dist',
    format: 'esm',
    // Keep feature initialization in its own module so downstream application
    // bundlers can drop unused lists, props, routing and lifecycle features.
    preserveModules: true,
    preserveModulesRoot: './src',
    minify: true,
    entryFileNames: '[name].js',
    chunkFileNames: 'chunks/[name]-[hash].js',
  },
});
