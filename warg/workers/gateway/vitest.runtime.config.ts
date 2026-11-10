import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// The runtime cases give each test its own logger, workflow and email stand-ins
// through the env they pass to the handlers; these only answer a stray call.
const unavailable = () => new Response('not in this test', { status: 503 });

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          INTERNAL_API_KEY: 'runtime-test-key-local-only',
          PUBLIC_API_KEY: 'unused',
          HEALTH_ALERT_FROM: 'alerts@example.com',
          HEALTH_ALERT_TO: 'owner@example.com'
        },
        serviceBindings: { LOGGER: unavailable, WORKFLOW: unavailable }
      }
    })
  ],
  test: {
    include: ['src/**/*.runtime.test.ts']
  }
});
