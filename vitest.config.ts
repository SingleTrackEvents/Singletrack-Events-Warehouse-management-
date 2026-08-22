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
    // The schema tests each boot Postgres compiled to WebAssembly. Two of those
    // starting at once on a loaded machine is enough to time one out, which
    // showed up as an intermittent failure. Running files one at a time costs
    // little — those tests dominate the runtime either way — and removes the
    // flakiness rather than leaving it for CI to hit.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
