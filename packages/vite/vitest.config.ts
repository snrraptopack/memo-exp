import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Full Vite+Rolldown builds take multiple seconds on slower machines.
    testTimeout: 30_000,
  },
});
