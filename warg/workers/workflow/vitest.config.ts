import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['src/**/*.runtime.test.ts', ...configDefaults.exclude]
  }
});
