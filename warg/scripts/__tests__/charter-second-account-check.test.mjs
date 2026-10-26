import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runCharterCheck } from '../charter-second-account-check.mjs';

// A stubbed fetch answers by URL. The token, uid and key are stub values; the
// test asserts none of them reaches the output.

const TOKEN = 'stub-id-token-value';
const UID = 'stub-anon-uid';
const KEY = 'stub-web-key';
const SHARED = 'shared-abc123';

function stubFetch(overrides = {}) {
  const calls = [];
  const answer = (status, body = {}) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  const fetchImpl = (url, init = {}) => {
    const method = init.method ?? 'GET';
    calls.push(`${method} ${url}`);
    if (url.includes('accounts:signUp')) return answer(200, { idToken: TOKEN, localId: UID });
    if (url.includes('accounts:delete')) return answer(200, {});
    if (url.includes('/articleMarkers')) return answer(overrides.marker ?? 403, { error: { status: 'PERMISSION_DENIED' } });
    if (url.includes('/documents/articles/')) return answer(overrides.read ?? 403, { error: { status: 'PERMISSION_DENIED' } });
    if (url.includes('/app/signed-url')) {
      const status = overrides.signed ?? 404;
      return answer(status, status === 200 ? { url: 'https://signed.example/x' } : { error: 'Article not found' });
    }
    if (method === 'DELETE') return answer(200, {});
    if (url.includes(`/users/${UID}/articles`)) return answer(200, { name: 'doc' });
    return answer(500, {});
  };
  return { fetchImpl, calls };
}

async function run(overrides) {
  const lines = [];
  const { fetchImpl, calls } = stubFetch(overrides);
  const code = await runCharterCheck({
    fetchImpl,
    apiKey: KEY,
    projectId: 'demo-project',
    sharedId: SHARED,
    signedUrlBase: 'https://dashboard-api.example/',
    log: (line) => lines.push(line),
  });
  return { code, lines, calls };
}

test('every refusal gives three PASS lines and exit 0', async () => {
  const { code, lines } = await run();
  assert.equal(code, 0);
  assert.deepEqual(lines, [
    'PASS marker-write-refused (403)',
    'PASS shared-read-refused (403)',
    'PASS signed-link-refused (404)',
  ]);
});

test('an accepted marker write is a FAIL with exit 1, and the cleanup still runs', async () => {
  const { code, lines, calls } = await run({ marker: 200 });
  assert.equal(code, 1);
  assert.ok(lines.includes('FAIL marker-write-refused (200)'));
  assert.ok(calls.some((c) => c.startsWith(`DELETE `) && c.includes(`/articles/${SHARED}`)));
  assert.ok(calls.some((c) => c.includes('accounts:delete')));
});

test('a signed link handed out is a FAIL', async () => {
  const { code, lines } = await run({ signed: 200 });
  assert.equal(code, 1);
  assert.ok(lines.includes('FAIL signed-link-refused (200)'));
});

test('the output never holds the token, the anonymous uid or the key', async () => {
  for (const overrides of [{}, { marker: 200, read: 200, signed: 200 }]) {
    const { lines } = await run(overrides);
    const out = lines.join('\n');
    for (const secret of [TOKEN, UID, KEY]) assert.equal(out.includes(secret), false, secret);
  }
});
