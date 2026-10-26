import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { statusKeyMatches, statusSecrets } from '../secrets.js';
import { backfillArchiver, backfillStatus } from '../index.js';

// Dummy values only. Each caller has its own key; the old shared key is
// accepted only while the key-rotation switch is on.
const OWN = 'status-k';
const STORAGE_WORKER = 'gcs-k';
const DASHBOARD = 'dash-k';
const OLD = 'old-k';

const NAMES = [
  'ARCHIVE_GATEWAY_KEY',
  'DASHBOARD_API_KEY',
  'BACKFILL_STATUS_KEY',
  'INTERNAL_API_KEY',
  'KEY_ROTATION_DUAL_ACCEPT',
];

function withEnv(values: Record<string, string>, fn: () => Promise<void> | void) {
  return async () => {
    const saved = new Map(NAMES.map((n) => [n, process.env[n]]));
    try {
      for (const n of NAMES) Reflect.deleteProperty(process.env, n);
      Object.assign(process.env, values);
      await fn();
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) Reflect.deleteProperty(process.env, k);
        else process.env[k] = v;
      }
    }
  };
}

// Every caller's key is present in the environment, as the worst case: only
// the endpoint's own key (and the old one, with the switch on) may pass.
const ALL_KEYS = {
  ARCHIVE_GATEWAY_KEY: STORAGE_WORKER,
  DASHBOARD_API_KEY: DASHBOARD,
  BACKFILL_STATUS_KEY: OWN,
  INTERNAL_API_KEY: OLD,
};

test('the status key is accepted', withEnv(ALL_KEYS, () => {
  assert.equal(statusKeyMatches(OWN), true);
}));

test('another caller key, an empty key and no key are refused', withEnv({ ...ALL_KEYS, KEY_ROTATION_DUAL_ACCEPT: 'true' }, () => {
  assert.equal(statusKeyMatches(STORAGE_WORKER), false);
  assert.equal(statusKeyMatches(DASHBOARD), false);
  assert.equal(statusKeyMatches(''), false);
  assert.equal(statusKeyMatches(null), false);
  assert.equal(statusKeyMatches(undefined), false);
}));

test('the old key is accepted while the switch is on', withEnv({ ...ALL_KEYS, KEY_ROTATION_DUAL_ACCEPT: 'true' }, () => {
  assert.equal(statusKeyMatches(OLD), true);
  assert.equal(statusKeyMatches(OWN), true);
}));

test('the old key is refused with the switch off', withEnv({ ...ALL_KEYS, KEY_ROTATION_DUAL_ACCEPT: 'false' }, () => {
  assert.equal(statusKeyMatches(OLD), false);
}));

test('the old key is refused with the switch unset', withEnv(ALL_KEYS, () => {
  assert.equal(statusKeyMatches(OLD), false);
}));

function fakeRes() {
  const headers: Record<string, string> = {};
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
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    end() {},
    // The cors wrapper of onRequest listens for 'finish'
    // (source: node_modules/firebase-functions/lib/esm/v2/providers/https.mjs:56).
    on() {
      return this;
    },
  } as unknown as Response;
  return { res, captured };
}

test('backfillStatus answers 401 to another caller key before any Firestore read', withEnv(ALL_KEYS, async () => {
  for (const key of [STORAGE_WORKER, DASHBOARD, OLD]) {
    const { res, captured } = fakeRes();
    const req = { method: 'GET', headers: { 'x-internal-api-key': key }, get: () => undefined } as unknown as Request;
    // A Firestore read would need credentials and the network; the handler
    // must finish with 401 before it reaches one.
    await (backfillStatus as unknown as (req: Request, res: Response) => Promise<void>)(req, res);
    assert.equal(captured.status, 401);
    assert.deepEqual(captured.body, { error: 'Unauthorized' });
  }
}));

const names = () => statusSecrets().map((s) => s.name);

test('the old key is bound only while the switch is on', async (t) => {
  await t.test('on', withEnv({ KEY_ROTATION_DUAL_ACCEPT: 'true' }, () => {
    assert.deepEqual(names(), ['BACKFILL_STATUS_KEY', 'INTERNAL_API_KEY']);
  }));
  await t.test('off', withEnv({ KEY_ROTATION_DUAL_ACCEPT: 'false' }, () => {
    assert.deepEqual(names(), ['BACKFILL_STATUS_KEY']);
  }));
  await t.test('unset', withEnv({}, () => {
    assert.deepEqual(names(), ['BACKFILL_STATUS_KEY']);
  }));
});

test('only the status endpoint binds the status key (switch unset at import)', () => {
  const keys = (fn: { __endpoint: { secretEnvironmentVariables?: { key: string }[] } }) =>
    (fn.__endpoint.secretEnvironmentVariables ?? []).map((s) => s.key);
  assert.deepEqual(keys(backfillStatus), ['BACKFILL_STATUS_KEY']);
  assert.ok(!keys(backfillArchiver).includes('BACKFILL_STATUS_KEY'));
  assert.ok(!keys(backfillArchiver).includes('INTERNAL_API_KEY'));
});
