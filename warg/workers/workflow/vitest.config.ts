import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': fileURLToPath(
        new URL('./src/test-support/cloudflare-workers.ts', import.meta.url)
      ),
      'cloudflare:workflows': fileURLToPath(
        new URL('./src/test-support/cloudflare-workflows.ts', import.meta.url)
      )
    }
  },
  test: {
    environment: 'node',
    exclude: ['src/**/*.runtime.test.ts', ...configDefaults.exclude]
  }
});
