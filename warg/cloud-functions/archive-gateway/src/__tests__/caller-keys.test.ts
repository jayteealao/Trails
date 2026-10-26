import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { verifyApiKey } from '../auth.js';
import { logEvent } from '../logging.js';
import { functionSecrets } from '../secrets.js';
import { archiveGateway } from '../index.js';

// Dummy values only. Each caller has its own key; the old shared key is
// accepted only while the key-rotation switch is on.
const OWN = 'gcs-k';
const DASHBOARD = 'dash-k';
const STATUS = 'status-k';
const OLD = 'old-k';

const NAMES = [
  'ARCHIVE_GATEWAY_KEY',
  'DASHBOARD_API_KEY',
  'BACKFILL_STATUS_KEY',
  'INTERNAL_API_KEY',
  'KEY_ROTATION_DUAL_ACCEPT',
  'GATEWAY_LOG_KEY',
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

// Every caller's key is present in the environment, as the worst case: only
// the function's own key (and the old one, with the switch on) may pass.
const ALL_KEYS = {
  ARCHIVE_GATEWAY_KEY: OWN,
  DASHBOARD_API_KEY: DASHBOARD,
  BACKFILL_STATUS_KEY: STATUS,
  INTERNAL_API_KEY: OLD,
};

function run(key?: string) {
  const headers: Record<string, string> = {};
  if (key !== undefined) headers['x-internal-api-key'] = key;
  const captured: { status?: number } = {};
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json() {
      return this;
    },
  } as unknown as Response;
  let nextCalled = false;
  verifyApiKey({ headers } as unknown as Request, res, () => {
    nextCalled = true;
  });
  return { nextCalled, status: captured.status };
}

const PASSED = { nextCalled: true, status: undefined };
const REFUSED = { nextCalled: false, status: 401 };

test('the storage worker key is accepted', withEnv(ALL_KEYS, () => {
  assert.deepEqual(run(OWN), PASSED);
}));

test('another caller key gets 401', withEnv({ ...ALL_KEYS, KEY_ROTATION_DUAL_ACCEPT: 'true' }, () => {
  assert.deepEqual(run(DASHBOARD), REFUSED);
  assert.deepEqual(run(STATUS), REFUSED);
}));

test('the old key is accepted while the switch is on', withEnv({ ...ALL_KEYS, KEY_ROTATION_DUAL_ACCEPT: 'true' }, () => {
  assert.deepEqual(run(OLD), PASSED);
  assert.deepEqual(run(OWN), PASSED);
}));

test('the old key gets 401 with the switch off', withEnv({ ...ALL_KEYS, KEY_ROTATION_DUAL_ACCEPT: 'false' }, () => {
  assert.deepEqual(run(OLD), REFUSED);
}));

test('the old key gets 401 with the switch unset', withEnv(ALL_KEYS, () => {
  assert.deepEqual(run(OLD), REFUSED);
}));

test('only the exact value true turns the switch on', withEnv({ ...ALL_KEYS, KEY_ROTATION_DUAL_ACCEPT: 'TRUE' }, () => {
  assert.deepEqual(run(OLD), REFUSED);
}));

test('a missing header gets 401', withEnv({ ...ALL_KEYS, KEY_ROTATION_DUAL_ACCEPT: 'true' }, () => {
  assert.deepEqual(run(), REFUSED);
  assert.deepEqual(run(''), REFUSED);
}));

test('an unset own key answers 500, even with the old key on', withEnv({ INTERNAL_API_KEY: OLD, KEY_ROTATION_DUAL_ACCEPT: 'true' }, () => {
  const logged: unknown[][] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  let result;
  try {
    result = run(OLD);
  } finally {
    console.error = realError;
  }
  assert.deepEqual(result, { nextCalled: false, status: 500 });
  assert.ok(logged.some((args) => String(args[0]).includes('ARCHIVE_GATEWAY_KEY not configured')));
}));

const names = (list: { name: string }[]) => list.map((s) => s.name);

test('the old key is bound only while the switch is on', async (t) => {
  await t.test('on', withEnv({ KEY_ROTATION_DUAL_ACCEPT: 'true' }, () => {
    assert.ok(names(functionSecrets()).includes('INTERNAL_API_KEY'));
  }));
  await t.test('off', withEnv({ KEY_ROTATION_DUAL_ACCEPT: 'false' }, () => {
    assert.ok(!names(functionSecrets()).includes('INTERNAL_API_KEY'));
  }));
  await t.test('unset', withEnv({}, () => {
    const bound = names(functionSecrets());
    assert.ok(!bound.includes('INTERNAL_API_KEY'));
    assert.ok(bound.includes('ARCHIVE_GATEWAY_KEY'));
    assert.ok(bound.includes('GATEWAY_LOG_KEY'));
  }));
});

test('the deployed function binds its own keys and not the old one (switch unset at import)', () => {
  const keys = (archiveGateway.__endpoint.secretEnvironmentVariables ?? []).map((s) => s.key);
  assert.ok(keys.includes('ARCHIVE_GATEWAY_KEY'));
  assert.ok(keys.includes('GATEWAY_LOG_KEY'));
  assert.ok(!keys.includes('INTERNAL_API_KEY'));
  assert.ok(!keys.includes('DASHBOARD_API_KEY'));
  assert.ok(!keys.includes('BACKFILL_STATUS_KEY'));
});

test(
  'the event log sends the log key, never a caller key',
  withEnv(
    { ...ALL_KEYS, KEY_ROTATION_DUAL_ACCEPT: 'true', GATEWAY_LOG_KEY: 'log-k', GATEWAY_URL: 'https://gateway.test' },
    async () => {
      const realFetch = globalThis.fetch;
      const sent: string[] = [];
      globalThis.fetch = (async (_url: string, init: { headers: Record<string, string> }) => {
        sent.push(init.headers['X-Internal-API-Key'] ?? '');
        return new Response(null, { status: 204 });
      }) as unknown as typeof fetch;
      try {
        await logEvent('req-1', 'gateway' as never, 'info' as never, 'hello');
      } finally {
        globalThis.fetch = realFetch;
      }
      assert.deepEqual(sent, ['log-k']);
    }
  )
);
