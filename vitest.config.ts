import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    // Root tests reset DOM/runtime state in their hooks, so reusing each
    // worker's module graph avoids paying compiler and environment startup
    // costs again for every test file.
    isolate: false,
    exclude: [...configDefaults.exclude, 'packages/*/tests/**'],
  },
});
