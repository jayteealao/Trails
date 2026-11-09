import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Browser checks run the real Pages functions under `wrangler pages dev`,
// pointed at a stub dashboard-api that each spec starts on STUB_PORT.
// The ports stay off the wrangler defaults so a local dev server is never
// mistaken for the one under test.
const PAGES_PORT = Number(process.env.E2E_PAGES_PORT ?? '18799');
const STUB_PORT = Number(process.env.E2E_STUB_PORT ?? '18798');
const LOGGER_PORT = Number(process.env.E2E_LOGGER_PORT ?? '18797');

// The browser checks run a stand-in for the logger service, joined to the
// local dashboard through wrangler's local registry of running Workers. Each
// run gets a fresh registry folder, so a stale entry left by an earlier run
// cannot break the connection. It is made once in the runner; the test
// workers inherit the variable and make no folder of their own.
const REGISTRY_PREFIX = 'warg-e2e-registry-';
// Registry folders of earlier runs are removed when they are older than this,
// so the temp folder does not fill up and a run still going is left alone.
const STALE_REGISTRY_MS = 60 * 60 * 1000;

function removeStaleRegistries(): void {
  const now = Date.now();
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith(REGISTRY_PREFIX)) continue;
    const path = join(tmpdir(), name);
    if (now - statSync(path).mtimeMs > STALE_REGISTRY_MS) rmSync(path, { recursive: true, force: true });
  }
}

if (process.env.E2E_WRANGLER_REGISTRY === undefined) removeStaleRegistries();
const REGISTRY = (process.env.E2E_WRANGLER_REGISTRY ??= mkdtempSync(join(tmpdir(), REGISTRY_PREFIX)));

// The dashboard credential of the local server under test (test strings only).
export const E2E_AUTH_USER = 'e2e-user';
export const E2E_AUTH_PASSWORD = 'e2e-pass';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PAGES_PORT}`,
    trace: 'retain-on-failure',
    // Answer the dashboard's sign-in challenge; scoped to the dashboard
    // origin so the stub dashboard-api never receives the credential.
    httpCredentials: {
      username: E2E_AUTH_USER,
      password: E2E_AUTH_PASSWORD,
      origin: `http://127.0.0.1:${PAGES_PORT}`,
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Started in order: the logger stand-in is up and registered before the
  // dashboard starts and binds it as LOGGER.
  webServer: [
    {
      command: `pnpm exec wrangler dev -c e2e/stub-logger.wrangler.toml --ip 127.0.0.1 --port ${LOGGER_PORT}`,
      url: `http://127.0.0.1:${LOGGER_PORT}/stats`,
      env: { WRANGLER_REGISTRY_PATH: REGISTRY },
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command:
        `pnpm exec wrangler pages dev . --ip 127.0.0.1 --port ${PAGES_PORT}` +
        ` --binding DASHBOARD_API_URL=http://127.0.0.1:${STUB_PORT}/` +
        ' --binding DASHBOARD_API_KEY=e2e-key' +
        ` --binding DASHBOARD_AUTH=${E2E_AUTH_USER}:${E2E_AUTH_PASSWORD}` +
        // The infra check points the infra function's Cloudflare API calls
        // at the stub that its spec starts on STUB_PORT (test strings only).
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
