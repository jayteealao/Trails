import test from 'node:test';
import assert from 'node:assert/strict';
import { gatewayBeginConfig } from '../secrets.js';
import { onUserArticleSave } from '../index.js';

// Each test sets the environment after the modules above were imported, so a
// value read at module load would make it fail.
const NAMES = ['PUBLIC_API_KEY', 'CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET'];

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

test(
  'gatewayBeginConfig returns the key that was set after import',
  withEnv({ PUBLIC_API_KEY: 'pk1', CF_ACCESS_CLIENT_ID: 'cf-id', CF_ACCESS_CLIENT_SECRET: 'cf-secret' }, () => {
    assert.deepEqual(gatewayBeginConfig('https://gateway.test'), {
      gatewayUrl: 'https://gateway.test',
      publicApiKey: 'pk1',
      cfAccessClientId: 'cf-id',
      cfAccessClientSecret: 'cf-secret',
    });
  })
);

test(
  'gatewayBeginConfig throws an error that names PUBLIC_API_KEY when the key is empty',
  withEnv({ PUBLIC_API_KEY: '' }, () => {
    assert.throws(() => gatewayBeginConfig('https://gateway.test'), /PUBLIC_API_KEY is not configured/);
  })
);

test('onUserArticleSave declares its keys as secrets', () => {
  const keys = (onUserArticleSave.__endpoint.secretEnvironmentVariables ?? []).map((s) => s.key);
  assert.ok(keys.includes('PUBLIC_API_KEY'));
  assert.ok(keys.includes('CF_ACCESS_CLIENT_ID'));
  assert.ok(keys.includes('CF_ACCESS_CLIENT_SECRET'));
});
