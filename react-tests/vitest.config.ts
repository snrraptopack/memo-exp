import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['react-tests/**/*.test.ts'],
    environment: 'happy-dom',
  },
});
