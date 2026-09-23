import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // CLI and example tests spawn child processes; give them room on slow CI boxes.
    testTimeout: 30_000,
  },
});
