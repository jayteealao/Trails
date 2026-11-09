import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// The stats panel check runs the dashboard against the real logger worker
// under `wrangler dev`, over a fresh local D1 that holds the rows of
// e2e-logger/seed.sql. It is run on demand (`test:e2e:logger`), not in CI;
// the specs of e2e/ keep the stub logger of playwright.config.ts. Both
// configs use the same ports, so run one at a time.
const PAGES_PORT = Number(process.env.E2E_PAGES_PORT ?? '18799');
const LOGGER_PORT = Number(process.env.E2E_LOGGER_PORT ?? '18797');
// Nothing listens here in this check; the dashboard API and Cloudflare API
// bindings point at it so that no call leaves the machine.
const STUB_PORT = Number(process.env.E2E_STUB_PORT ?? '18798');

// Each run gets its own wrangler registry and D1 folder, so a stale entry or
// the rows of an earlier run cannot leak in. Made once in the runner; the
// test workers inherit the variables.
const REGISTRY = (process.env.E2E_WRANGLER_REGISTRY ??= mkdtempSync(join(tmpdir(), 'warg-e2e-registry-')));
const PERSIST = (process.env.E2E_LOGGER_PERSIST ??= mkdtempSync(join(tmpdir(), 'warg-e2e-logger-d1-')));

const LOGGER_DIR = resolve(__dirname, '../../workers/logger');
const SEED = resolve(__dirname, 'e2e-logger/seed.sql');

// The key between the dashboard and the logger, and the dashboard credential
// of the local server under test (test strings only).
const INTERNAL_KEY = 'e2e-internal-key';
const E2E_AUTH_USER = 'e2e-user';
const E2E_AUTH_PASSWORD = 'e2e-pass';

export default defineConfig({
  testDir: './e2e-logger',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PAGES_PORT}`,
    trace: 'retain-on-failure',
    httpCredentials: {
      username: E2E_AUTH_USER,
      password: E2E_AUTH_PASSWORD,
      origin: `http://127.0.0.1:${PAGES_PORT}`,
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Started in order: the logger is migrated, seeded, up and registered
  // before the dashboard starts and binds it as LOGGER.
  webServer: [
    {
      command:
        `pnpm exec wrangler d1 migrations apply warg-requests-index --local --persist-to "${PERSIST}"` +
        ` && pnpm exec wrangler d1 execute warg-requests-index --local --persist-to "${PERSIST}" --file "${SEED}"` +
        ` && pnpm exec wrangler dev --persist-to "${PERSIST}" --ip 127.0.0.1 --port ${LOGGER_PORT}` +
        ` --var INTERNAL_API_KEY:${INTERNAL_KEY}`,
      cwd: LOGGER_DIR,
      // A 401 without the key counts as up.
      url: `http://127.0.0.1:${LOGGER_PORT}/stats`,
      env: { WRANGLER_REGISTRY_PATH: REGISTRY, CI: '1' },
      timeout: 180_000,
      reuseExistingServer: false,
    },
    {
      command:
        `pnpm exec wrangler pages dev . --ip 127.0.0.1 --port ${PAGES_PORT}` +
        ` --binding DASHBOARD_AUTH=${E2E_AUTH_USER}:${E2E_AUTH_PASSWORD}` +
        ` --binding INTERNAL_API_KEY=${INTERNAL_KEY}` +
        ` --binding DASHBOARD_API_URL=http://127.0.0.1:${STUB_PORT}/` +
        ' --binding DASHBOARD_API_KEY=e2e-key' +
        ' --binding CF_API_TOKEN=e2e-cf-token' +
        ' --binding CF_ACCOUNT_ID=e2e-account' +
        ` --binding CF_API_URL=http://127.0.0.1:${STUB_PORT}/client/v4` +
        ' --service LOGGER=logger',
      url: `http://127.0.0.1:${PAGES_PORT}/`,
      env: { WRANGLER_REGISTRY_PATH: REGISTRY },
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
