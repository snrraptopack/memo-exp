import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Live Vite servers and Chrome teardown compete for the same machine.
    // Concurrent browser files can time out after their assertions passed,
    // especially on Windows; keep this integration suite deterministic.
    fileParallelism: false,
    // Full Vite+Rolldown builds take multiple seconds on slower machines.
    testTimeout: 30_000,
  },
});
