import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { loggerServer, pagesServer } from './e2e-logger/local-servers';

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
    loggerServer({
      port: LOGGER_PORT,
      registry: REGISTRY,
      persist: PERSIST,
      internalKey: INTERNAL_KEY,
      seedFile: SEED,
    }),
    pagesServer({
      port: PAGES_PORT,
      registry: REGISTRY,
      stubPort: STUB_PORT,
      internalKey: INTERNAL_KEY,
      user: E2E_AUTH_USER,
      password: E2E_AUTH_PASSWORD,
    }),
  ],
});
