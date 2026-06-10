import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // The emulator is shared process-wide; a single fork keeps clearFirestore()
    // between tests from racing parallel workers.
    pool: 'forks',
    maxWorkers: 1,
    isolate: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
