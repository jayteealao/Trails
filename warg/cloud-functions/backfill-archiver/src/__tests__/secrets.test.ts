import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { getBackfillUserId, statusKeyMatches } from '../secrets.js';
import { backfillArchiver, backfillStatus } from '../index.js';

// Each test sets the environment after the modules above were imported, so a
// value read at module load would make it fail.
const NAMES = ['BACKFILL_STATUS_KEY', 'INTERNAL_API_KEY', 'KEY_ROTATION_DUAL_ACCEPT', 'BACKFILL_USER_ID'];

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

test('statusKeyMatches accepts the key set after import', withEnv({ BACKFILL_STATUS_KEY: 'ik1' }, () => {
  assert.equal(statusKeyMatches('ik1'), true);
}));

test('statusKeyMatches refuses a wrong, empty or missing key', withEnv({ BACKFILL_STATUS_KEY: 'ik1' }, () => {
  assert.equal(statusKeyMatches('wrong'), false);
  assert.equal(statusKeyMatches(''), false);
  assert.equal(statusKeyMatches(null), false);
  assert.equal(statusKeyMatches(undefined), false);
}));

test('statusKeyMatches refuses every key when the secret is not configured', withEnv({}, () => {
  assert.equal(statusKeyMatches(''), false);
  assert.equal(statusKeyMatches('ik1'), false);
}));

test('backfillStatus answers 401 to a wrong key before any Firestore read', withEnv({ BACKFILL_STATUS_KEY: 'ik1' }, async () => {
  const headers: Record<string, string> = {};
  const captured: { status?: number; body?: unknown } = {};
  const req = { method: 'GET', headers: { 'x-internal-api-key': 'wrong' }, get: () => undefined } as unknown as Request;
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

  // A Firestore read would need credentials and the network; the handler must
  // finish with 401 before it reaches one.
  await (backfillStatus as unknown as (req: Request, res: Response) => Promise<void>)(req, res);
  assert.equal(captured.status, 401);
  assert.deepEqual(captured.body, { error: 'Unauthorized' });
}));

test('getBackfillUserId throws an error that names BACKFILL_USER_ID when it is unset', withEnv({}, () => {
  assert.throws(() => getBackfillUserId(), /BACKFILL_USER_ID is not configured/);
}));

test('getBackfillUserId returns the value set after import', withEnv({ BACKFILL_USER_ID: 'user-1' }, () => {
  assert.equal(getBackfillUserId(), 'user-1');
}));

test('each function declares only the key it uses', () => {
  const keys = (fn: { __endpoint: { secretEnvironmentVariables?: { key: string }[] } }) =>
    (fn.__endpoint.secretEnvironmentVariables ?? []).map((s) => s.key);
  assert.ok(keys(backfillArchiver).includes('PUBLIC_API_KEY'));
  assert.ok(!keys(backfillArchiver).includes('INTERNAL_API_KEY'));
  assert.ok(!keys(backfillArchiver).includes('BACKFILL_STATUS_KEY'));
  assert.deepEqual(keys(backfillStatus), ['BACKFILL_STATUS_KEY']);
});
