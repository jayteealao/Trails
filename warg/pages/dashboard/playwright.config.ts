import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { dashboardServer, stubLoggerServer } from './e2e-logger/local-servers';

// Browser checks run the real dashboard Worker under `cf dev` (local only,
// from cloudflare.config.ts), pointed at a stub dashboard-api that each spec
// starts on STUB_PORT.
// The ports stay off the dev-server defaults so a local dev server is never
// mistaken for the one under test.
const PAGES_PORT = Number(process.env.E2E_PAGES_PORT ?? '18799');
const STUB_PORT = Number(process.env.E2E_STUB_PORT ?? '18798');
const LOGGER_PORT = Number(process.env.E2E_LOGGER_PORT ?? '18797');

// The browser checks run a stand-in for the logger service, joined to the
// local dashboard through the local dev registry of running Workers. Each
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
  // dashboard starts and binds it as LOGGER; GATEWAY is not running.
  webServer: [
    stubLoggerServer({ port: LOGGER_PORT, registry: REGISTRY }),
    dashboardServer({
      port: PAGES_PORT,
      registry: REGISTRY,
      mode: 'e2e',
      // The dashboard API and the infra function's Cloudflare API calls go to
      // the stub that each spec starts on STUB_PORT.
      stubPort: STUB_PORT,
      user: E2E_AUTH_USER,
      password: E2E_AUTH_PASSWORD,
    }),
  ],
});
