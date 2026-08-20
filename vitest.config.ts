import { defineConfig } from 'vitest/config';

/**
 * Tests run against the real Dexie stack on a fake IndexedDB, so the domain
 * logic is exercised through the same transactions the app uses rather than a
 * mock that can drift away from it.
 */
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts'],
  },
});
