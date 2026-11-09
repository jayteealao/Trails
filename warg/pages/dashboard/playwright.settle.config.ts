import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import { loggerServer, pagesServer, workflowServer } from './e2e-logger/local-servers';

// The settle check runs one archive request end to end on this machine: the
// real logger over a fresh local D1, the real workflow worker in mock mode on
// the local Workflows engine, and the dashboard bound to the logger. It is
// run on demand (`test:e2e:settle`), not in CI. Its ports differ from the
// stats check, but both default the logger to a port near 18897; run one
// browser check at a time.
const PAGES_PORT = Number(process.env.E2E_SETTLE_PAGES_PORT ?? '18899');
const LOGGER_PORT = Number(process.env.E2E_SETTLE_LOGGER_PORT ?? '18897');
const WORKFLOW_PORT = Number(process.env.E2E_SETTLE_WORKFLOW_PORT ?? '18896');
// Nothing listens here; the dashboard API and Cloudflare API bindings point
// at it so that no call leaves the machine.
const STUB_PORT = Number(process.env.E2E_SETTLE_STUB_PORT ?? '18898');

// One fresh wrangler registry and fresh D1 and R2 folders per run. Made once
// in the runner; the test workers inherit the variables.
const REGISTRY = (process.env.E2E_SETTLE_REGISTRY ??= mkdtempSync(join(tmpdir(), 'warg-e2e-registry-')));
const LOGGER_PERSIST = (process.env.E2E_SETTLE_LOGGER_PERSIST ??= mkdtempSync(join(tmpdir(), 'warg-e2e-logger-d1-')));
const WORKFLOW_PERSIST = (process.env.E2E_SETTLE_WORKFLOW_PERSIST ??= mkdtempSync(join(tmpdir(), 'warg-e2e-workflow-')));

// The request the spec archives; its options object is put in R2 before the
// workflow starts. Test strings only.
const SETTLE_REQUEST_ID = 'e2e-settle-done-0001';
const SETTLE_OPTIONS_KEY = `archives/${SETTLE_REQUEST_ID}/input/options.json`;
const OPTIONS_FILE = resolve(__dirname, 'e2e-settle/options.json');
const INTERNAL_KEY = 'e2e-internal-key';
const E2E_AUTH_USER = 'e2e-user';
const E2E_AUTH_PASSWORD = 'e2e-pass';

process.env.E2E_SETTLE_LOGGER_URL = `http://127.0.0.1:${LOGGER_PORT}`;
process.env.E2E_SETTLE_WORKFLOW_URL = `http://127.0.0.1:${WORKFLOW_PORT}`;
process.env.E2E_SETTLE_INTERNAL_KEY = INTERNAL_KEY;

export default defineConfig({
  testDir: './e2e-settle',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  timeout: 90_000,
  use: {
    baseURL: `http://127.0.0.1:${PAGES_PORT}`,
    trace: 'retain-on-failure',
    httpCredentials: {
      username: E2E_AUTH_USER,
      password: E2E_AUTH_PASSWORD,
      origin: `http://127.0.0.1:${PAGES_PORT}`,
    },
  },
  // Started in order: the logger is up and registered before the workflow
  // and the dashboard bind it as LOGGER.
  webServer: [
    loggerServer({
      port: LOGGER_PORT,
      registry: REGISTRY,
      persist: LOGGER_PERSIST,
      internalKey: INTERNAL_KEY,
    }),
    workflowServer({
      port: WORKFLOW_PORT,
      registry: REGISTRY,
      persist: WORKFLOW_PERSIST,
      internalKey: INTERNAL_KEY,
      optionsKey: SETTLE_OPTIONS_KEY,
      optionsFile: OPTIONS_FILE,
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
