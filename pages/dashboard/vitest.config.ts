import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['functions/**/__tests__/**/*.test.ts'],
  },
});
