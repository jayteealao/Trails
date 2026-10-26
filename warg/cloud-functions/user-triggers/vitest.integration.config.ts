import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Only the Firestore emulator suites. The unit tests under src/__tests__
    // run under `node --test` (see the `test` script), not vitest.
    include: ['test/**/*.int.test.ts'],
    // The emulator is shared process-wide; a single fork keeps clearEmulator()
    // between tests from racing parallel workers.
    pool: 'forks',
    maxWorkers: 1,
    isolate: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
