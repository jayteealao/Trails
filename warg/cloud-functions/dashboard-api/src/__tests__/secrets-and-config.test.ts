import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { verifyApiKey } from '../auth.js';
import { dashboardUserConfigured, getDashboardUserId } from '../config.js';
import { dashboardApi } from '../index.js';

// Each test sets the environment after the modules above were imported, so a
// value read at module load would make it fail.
const NAMES = ['DASHBOARD_API_KEY', 'INTERNAL_API_KEY', 'KEY_ROTATION_DUAL_ACCEPT', 'DASHBOARD_USER_ID'];

function withEnv(values: Record<string, string>, fn: () => void) {
  return () => {
    const saved = new Map(NAMES.map((n) => [n, process.env[n]]));
    try {
      for (const n of NAMES) Reflect.deleteProperty(process.env, n);
      Object.assign(process.env, values);
      fn();
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) Reflect.deleteProperty(process.env, k);
        else process.env[k] = v;
      }
    }
  };
}

function makeRes() {
  const captured: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
  } as unknown as Response;
  return { res, captured };
}

function run(key?: string) {
  const headers: Record<string, string> = {};
  if (key !== undefined) headers['x-internal-api-key'] = key;
  const { res, captured } = makeRes();
  let nextCalled = false;
  verifyApiKey({ headers } as unknown as Request, res, () => {
    nextCalled = true;
  });
  return { nextCalled, status: captured.status };
}

test('verifyApiKey accepts the key set after import', withEnv({ DASHBOARD_API_KEY: 'dk1' }, () => {
  assert.deepEqual(run('dk1'), { nextCalled: true, status: undefined });
}));

test('verifyApiKey refuses a wrong or missing key with 401', withEnv({ DASHBOARD_API_KEY: 'dk1' }, () => {
  assert.deepEqual(run('wrong'), { nextCalled: false, status: 401 });
  assert.deepEqual(run(), { nextCalled: false, status: 401 });
}));

test('verifyApiKey answers 500 when the secret is not configured', withEnv({}, () => {
  assert.deepEqual(run('dk1'), { nextCalled: false, status: 500 });
}));

test('getDashboardUserId throws an error that names DASHBOARD_USER_ID when it is unset', withEnv({}, () => {
  assert.throws(() => getDashboardUserId(), /DASHBOARD_USER_ID is not configured/);
}));

test('getDashboardUserId returns the value set after import', withEnv({ DASHBOARD_USER_ID: 'user-1' }, () => {
  assert.equal(getDashboardUserId(), 'user-1');
}));

test('dashboardApi declares DASHBOARD_API_KEY as a secret', () => {
  const keys = (dashboardApi.__endpoint.secretEnvironmentVariables ?? []).map((s) => s.key);
  assert.deepEqual(keys, ['DASHBOARD_API_KEY']);
});

test('with a valid key and no user configured, the dashboard answers 500 and logs the name', withEnv({}, () => {
  const { res, captured } = makeRes();
  const logged: unknown[][] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  let configured: boolean;
  try {
    configured = dashboardUserConfigured(res);
  } finally {
    console.error = realError;
  }
  assert.equal(configured, false);
  assert.equal(captured.status, 500);
  assert.deepEqual(captured.body, { error: 'Server misconfigured' });
  assert.ok(logged.some((args) => String(args[0]).includes('DASHBOARD_USER_ID is not configured')));
}));

test('with the user configured, the guard lets the request through', withEnv({ DASHBOARD_USER_ID: 'user-1' }, () => {
  const { res, captured } = makeRes();
  assert.equal(dashboardUserConfigured(res), true);
  assert.equal(captured.status, undefined);
}));
