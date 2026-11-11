import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { TestConfig } from '@playwright/test';

// The local Workers that the browser checks run, each as one Playwright
// `webServer` entry. All of them join one local dev registry, so the
// dashboard and the workflow reach the logger by its service name.
//
// The dashboard and the stand-in logger run under `cf dev`. cf 1.0.0-beta.17
// hands `cf dev` to wrangler's cf-wrangler delegate
// (node_modules/wrangler/bin/cf-wrangler.js), which reads cloudflare.config.ts
// and wrangler.config.ts from the working folder and accepts only --mode,
// --host, --port and --local. So the test values go in `.dev.vars.<mode>`
// beside the config (gitignored, written here before each run), and the
// registry folder is set with CLOUDFLARE_REGISTRY_PATH: cf derives
// WRANGLER_REGISTRY_PATH from it and overwrites any value set directly.
//
// The real logger and workflow workers stay on `wrangler dev`: each run needs
// its own D1 and R2 folder (--persist-to), and `cf dev` has no such option.
// Under `cf dev` they would use the worker's own .wrangler/state, the local
// data of whoever runs the checks.

type WebServerEntry = Extract<NonNullable<TestConfig['webServer']>, { command: string }>;

const LOGGER_DIR = resolve(__dirname, '../../../workers/logger');
const WORKFLOW_DIR = resolve(__dirname, '../../../workers/workflow');
const DASHBOARD_DIR = resolve(__dirname, '..');
const STUB_LOGGER_DIR = resolve(__dirname, '../e2e/stub-logger');

/**
 * Writes the test values that `cf dev --mode <mode>` loads in place of
 * `.dev.vars`. A `.dev.vars` of the person running the checks is not read.
 * The Playwright config is loaded again in each test worker; the file is
 * written only when its text changes, so the dev server does not reload
 * mid-run.
 */
function writeDevVars(dir: string, mode: string, vars: Record<string, string>): void {
  const path = join(dir, `.dev.vars.${mode}`);
  const lines = Object.entries(vars).map(([key, value]) => `${key}=${value}`);
  const text = `# Written by e2e-logger/local-servers.ts for the browser checks (test strings only).\n${lines.join('\n')}\n`;
  if (existsSync(path) && readFileSync(path, 'utf8') === text) return;
  writeFileSync(path, text);
}

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
    // wrangler dev, not cf dev: the run needs its own D1 folder (--persist-to).
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
    // wrangler dev, not cf dev: the run needs its own R2 and Workflows folder (--persist-to).
    // --local turns the remote bindings off: Workers AI always runs remotely and
    // needs a Cloudflare token, and the mock pipeline never calls it.
    command:
      `pnpm exec wrangler r2 object put "warg-archives/${optionsKey}" --local --persist-to "${persist}"` +
      ` --file "${optionsFile}"` +
      ` && pnpm exec wrangler dev --local --persist-to "${persist}" --ip 127.0.0.1 --port ${port}` +
      ` --var INTERNAL_API_KEY:${internalKey} --var MOCK_PIPELINE:true`,
    cwd: WORKFLOW_DIR,
    // GET /status/ without an instance id answers 400, which counts as up.
    url: `http://127.0.0.1:${port}/status/`,
    env: { WRANGLER_REGISTRY_PATH: registry, CI: '1' },
    timeout: 180_000,
    reuseExistingServer: false,
  };
}

/** The browser checks' stand-in logger (e2e/stub-logger) under `cf dev`. */
export function stubLoggerServer(options: { port: number; registry: string }): WebServerEntry {
  const { port, registry } = options;
  return {
    // The stand-in's config runs only in the e2e mode, so it cannot be deployed.
    command: `pnpm exec cf dev --mode e2e --port ${port}`,
    cwd: STUB_LOGGER_DIR,
    url: `http://127.0.0.1:${port}/stats`,
    env: { CLOUDFLARE_REGISTRY_PATH: registry, CI: '1' },
    timeout: 120_000,
    reuseExistingServer: false,
  };
}

/**
 * The dashboard Worker under `cf dev`, bound to the logger; the dashboard API
 * and the Cloudflare API point at `stubPort`. `mode` names the
 * `.dev.vars.<mode>` file of this run; each Playwright config uses its own.
 * Without `internalKey` the dashboard has no logger key (the stand-in logger
 * checks none).
 */
export function dashboardServer(options: {
  port: number;
  registry: string;
  mode: string;
  stubPort: number;
  user: string;
  password: string;
  internalKey?: string;
}): WebServerEntry {
  const { port, registry, mode, stubPort, user, password, internalKey } = options;
  writeDevVars(DASHBOARD_DIR, mode, {
    DASHBOARD_AUTH: `${user}:${password}`,
    ...(internalKey === undefined ? {} : { INTERNAL_API_KEY: internalKey }),
    DASHBOARD_API_URL: `http://127.0.0.1:${stubPort}/`,
    DASHBOARD_API_KEY: 'e2e-key',
    CF_API_TOKEN: 'e2e-cf-token',
    CF_ACCOUNT_ID: 'e2e-account',
    CF_API_URL: `http://127.0.0.1:${stubPort}/client/v4`,
  });
  return {
    // LOGGER and GATEWAY are the service bindings of cloudflare.config.ts.
    command: `pnpm exec cf dev --mode ${mode} --port ${port}`,
    cwd: DASHBOARD_DIR,
    url: `http://127.0.0.1:${port}/`,
    env: { CLOUDFLARE_REGISTRY_PATH: registry, CI: '1' },
    timeout: 120_000,
    reuseExistingServer: false,
  };
}
