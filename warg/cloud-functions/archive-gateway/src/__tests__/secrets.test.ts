import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { verifyApiKey } from '../auth.js';
import { logEvent } from '../logging.js';
import { archiveGateway } from '../index.js';

// Each test sets the environment after the modules above were imported, so a
// value read at module load would make it fail.
const NAMES = [
  'ARCHIVE_GATEWAY_KEY',
  'GATEWAY_LOG_KEY',
  'INTERNAL_API_KEY',
  'KEY_ROTATION_DUAL_ACCEPT',
  'CF_ACCESS_CLIENT_ID',
  'CF_ACCESS_CLIENT_SECRET',
  'GATEWAY_URL',
];

function withEnv(values: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  return async () => {
    const saved = new Map(NAMES.map((n) => [n, process.env[n]]));
    try {
      for (const n of NAMES) Reflect.deleteProperty(process.env, n);
      for (const [k, v] of Object.entries(values)) if (v !== undefined) process.env[k] = v;
      await fn();
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) Reflect.deleteProperty(process.env, k);
        else process.env[k] = v;
      }
    }
  };
}

function makeReq(key?: string): Request {
  const headers: Record<string, string> = {};
  if (key !== undefined) headers['x-internal-api-key'] = key;
  return { headers } as unknown as Request;
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
  const { res, captured } = makeRes();
  let nextCalled = false;
  verifyApiKey(makeReq(key), res, () => {
    nextCalled = true;
  });
  return { nextCalled, status: captured.status };
}

test('verifyApiKey accepts the key set after import', withEnv({ ARCHIVE_GATEWAY_KEY: 'k1' }, () => {
  assert.deepEqual(run('k1'), { nextCalled: true, status: undefined });
}));

test('verifyApiKey refuses a wrong or missing key with 401', withEnv({ ARCHIVE_GATEWAY_KEY: 'k1' }, () => {
  assert.deepEqual(run('wrong'), { nextCalled: false, status: 401 });
  assert.deepEqual(run(), { nextCalled: false, status: 401 });
}));

test('verifyApiKey answers 500 when the secret is not configured', withEnv({}, () => {
  assert.deepEqual(run('k1'), { nextCalled: false, status: 500 });
}));

test('archiveGateway declares its keys as secrets', () => {
  const keys = (archiveGateway.__endpoint.secretEnvironmentVariables ?? []).map((s) => s.key);
  assert.ok(keys.includes('ARCHIVE_GATEWAY_KEY'));
  assert.ok(keys.includes('GATEWAY_LOG_KEY'));
  assert.ok(keys.includes('CF_ACCESS_CLIENT_ID'));
  assert.ok(keys.includes('CF_ACCESS_CLIENT_SECRET'));
});

test(
  'logEvent sends the key that was set after import',
  withEnv(
    {
      GATEWAY_LOG_KEY: 'log-key',
      CF_ACCESS_CLIENT_ID: 'cf-id',
      CF_ACCESS_CLIENT_SECRET: 'cf-secret',
      GATEWAY_URL: 'https://gateway.test',
    },
    async () => {
      const realFetch = globalThis.fetch;
      const calls: { url: string; headers: Record<string, string> }[] = [];
      globalThis.fetch = (async (url: string, init: { headers: Record<string, string> }) => {
        calls.push({ url, headers: init.headers });
        return new Response(null, { status: 204 });
      }) as unknown as typeof fetch;
      try {
        await logEvent('req-1', 'gateway' as never, 'info' as never, 'hello');
      } finally {
        globalThis.fetch = realFetch;
      }
      assert.equal(calls.length, 1);
      assert.equal(calls[0]?.url, 'https://gateway.test/internal/log');
      assert.equal(calls[0]?.headers['X-Internal-API-Key'], 'log-key');
      assert.equal(calls[0]?.headers['CF-Access-Client-Id'], 'cf-id');
      assert.equal(calls[0]?.headers['CF-Access-Client-Secret'], 'cf-secret');
    }
  )
);
