import { resolve } from 'node:path';
import type { TestConfig } from '@playwright/test';

// The local Workers that the browser checks run against the real logger,
// each as one Playwright `webServer` entry. All of them join one wrangler
// registry, so the dashboard and the workflow reach the logger by its
// service name.

type WebServerEntry = Extract<NonNullable<TestConfig['webServer']>, { command: string }>;

const LOGGER_DIR = resolve(__dirname, '../../../workers/logger');
const WORKFLOW_DIR = resolve(__dirname, '../../../workers/workflow');
const DASHBOARD_DIR = resolve(__dirname, '..');

/** The real logger under `wrangler dev`, over a freshly migrated local D1 (seeded when `seedFile` is given). */
export function loggerServer(options: {
  port: number;
  registry: string;
  persist: string;
  internalKey: string;
  seedFile?: string;
}): WebServerEntry {
  const { port, registry, persist, internalKey, seedFile } = options;
  return {
    command:
      `pnpm exec wrangler d1 migrations apply warg-requests-index --local --persist-to "${persist}"` +
      (seedFile
        ? ` && pnpm exec wrangler d1 execute warg-requests-index --local --persist-to "${persist}" --file "${seedFile}"`
        : '') +
      ` && pnpm exec wrangler dev --persist-to "${persist}" --ip 127.0.0.1 --port ${port}` +
      ` --var INTERNAL_API_KEY:${internalKey}`,
    cwd: LOGGER_DIR,
    // A 401 without the key counts as up.
    url: `http://127.0.0.1:${port}/stats`,
    env: { WRANGLER_REGISTRY_PATH: registry, CI: '1' },
    timeout: 180_000,
    reuseExistingServer: false,
  };
}

/**
 * The real workflow worker under `wrangler dev` in mock mode, on the local
 * Workflows engine, bound to the logger. The options object of the request is
 * first put in a fresh local R2, where the run reads it.
 */
export function workflowServer(options: {
  port: number;
  registry: string;
  persist: string;
  internalKey: string;
  optionsKey: string;
  optionsFile: string;
}): WebServerEntry {
  const { port, registry, persist, internalKey, optionsKey, optionsFile } = options;
  return {
    command:
      `pnpm exec wrangler r2 object put "warg-archives/${optionsKey}" --local --persist-to "${persist}"` +
      ` --file "${optionsFile}"` +
      ` && pnpm exec wrangler dev --persist-to "${persist}" --ip 127.0.0.1 --port ${port}` +
      ` --var INTERNAL_API_KEY:${internalKey} --var MOCK_PIPELINE:true`,
    cwd: WORKFLOW_DIR,
    // GET /status/ without an instance id answers 400, which counts as up.
    url: `http://127.0.0.1:${port}/status/`,
    env: { WRANGLER_REGISTRY_PATH: registry, CI: '1' },
    timeout: 180_000,
    reuseExistingServer: false,
  };
}

/** The dashboard under `wrangler pages dev`, bound to the logger; the other APIs point at a port where nothing listens. */
export function pagesServer(options: {
  port: number;
  registry: string;
  stubPort: number;
  internalKey: string;
  user: string;
  password: string;
}): WebServerEntry {
  const { port, registry, stubPort, internalKey, user, password } = options;
  return {
    command:
      `pnpm exec wrangler pages dev . --ip 127.0.0.1 --port ${port}` +
      ` --binding DASHBOARD_AUTH=${user}:${password}` +
      ` --binding INTERNAL_API_KEY=${internalKey}` +
      ` --binding DASHBOARD_API_URL=http://127.0.0.1:${stubPort}/` +
      ' --binding DASHBOARD_API_KEY=e2e-key' +
      ' --binding CF_API_TOKEN=e2e-cf-token' +
      ' --binding CF_ACCOUNT_ID=e2e-account' +
      ` --binding CF_API_URL=http://127.0.0.1:${stubPort}/client/v4` +
      ' --service LOGGER=logger',
    cwd: DASHBOARD_DIR,
    url: `http://127.0.0.1:${port}/`,
    env: { WRANGLER_REGISTRY_PATH: registry },
    timeout: 120_000,
    reuseExistingServer: false,
  };
}
