import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Only the emulator-backed integration suites. The pure `*.unit.test.ts`
    // files run under `node --test` (see the `test` script), not vitest.
    include: ['src/__tests__/**/*.int.test.ts'],
    // The emulator is shared process-wide; a single fork keeps clearEmulator()
    // between tests from racing parallel workers.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
