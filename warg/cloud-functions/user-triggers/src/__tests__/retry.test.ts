import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import * as firestore from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { makeRecordingDb } from './recording-firestore.js';

// Drives the deployed callable end to end: the real gateway client posts to a
// scripted fetch, and Firestore is the recording store. Times are relative to
// the real clock. The store has no transaction isolation; the emulator suite
// holds the concurrency cases.

process.env['PUBLIC_API_KEY'] = 'pk-test';
process.env['CF_ACCESS_CLIENT_ID'] = 'cf-id';
process.env['CF_ACCESS_CLIENT_SECRET'] = 'cf-secret';
process.env['GATEWAY_URL'] = 'https://gateway.test';

const USER = 'user0001';
const ITEM = 'item1234';
const SHARED = 'shared01';
const SHARED_PATH = `articles/${SHARED}`;
const URL = 'https://www.example.com/a';
const MINUTE = 60 * 1000;

const current: { store: ReturnType<typeof makeRecordingDb> } = { store: makeRecordingDb() };
mock.module('firebase-admin/firestore', {
  namedExports: { ...firestore, getFirestore: () => current.store.db },
});

const { retryArchive } = await import('../index.js');

type Doc = Record<string, unknown>;

const realFetch = globalThis.fetch;
let posts: Array<{ url: string; body: unknown }> = [];

/** Answers each post with the next response; a function runs in place of an answer. */
function answer(...responses: Array<{ status: number; body: string } | (() => Response)>): void {
  const queue = [...responses];
  globalThis.fetch = async (input: string | globalThis.URL | Request, init?: RequestInit) => {
    posts.push({ url: String(input), body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body });
    const next = queue.shift();
    if (!next) throw new Error('unexpected fetch');
    return typeof next === 'function' ? next() : new Response(next.body, { status: next.status });
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
  posts = [];
});

const ago = (ms: number) => firestore.Timestamp.fromMillis(Date.now() - ms);
const failed = (): Doc => ({ url: URL, status: 'failed', error: 'boom', archives: {} });

function seed(shared: Doc | undefined, opts: { user?: Doc; more?: Record<string, Doc> } = {}) {
  current.store = makeRecordingDb({
    users: { [`${USER}/articles/${ITEM}`]: opts.user ?? { url: URL, canonicalId: SHARED } },
    articles: { ...(shared ? { [SHARED]: shared } : {}), ...opts.more },
  });
  return current.store;
}

type RetryRequest = Parameters<typeof retryArchive.run>[0];

function call(data: unknown, uid = USER) {
  const raw = { data, auth: { uid, token: {} } };
  // Boundary cast: the callable reads only data and auth of the platform request.
  return retryArchive.run(raw as unknown as RetryRequest);
}

const retry = () => call({ itemId: ITEM });
const started = { status: 201, body: '{"requestId":"shared01"}' };

const hasCode = (code: string) => (error: unknown) => {
  assert.ok(error instanceof HttpsError);
  assert.equal(error.code, code);
  return true;
};

function assertNothingDone(store: ReturnType<typeof makeRecordingDb>) {
  assert.deepEqual(posts, []);
  assert.deepEqual(store.writes, []);
}

test('a failed article is claimed, started once at the gateway and recorded', async () => {
  const store = seed(failed());
  answer(started);
  assert.deepEqual(await retry(), { outcome: 'started' });
  assert.deepEqual(posts, [
    {
      url: 'https://gateway.test/begin',
      body: { url: URL, request_id: SHARED, includeScreenshot: true, includePdf: true },
    },
  ]);
  assert.deepEqual(store.writes, [
    {
      method: 'update',
      inTransaction: true,
      path: SHARED_PATH,
      data: { status: 'processing', processing_started_at: '<timestamp>' },
      merge: false,
    },
    {
      method: 'update',
      inTransaction: false,
      path: SHARED_PATH,
      data: { warg_request_id: SHARED, status: 'processing', processing_started_at: '<timestamp>' },
      merge: false,
    },
  ]);
  assert.equal(store.docs.get(SHARED_PATH)?.['error'], 'boom');
});

test('a second retry right after a started one answers in flight and calls nothing', async () => {
  seed(failed());
  answer(started);
  await retry();
  assert.deepEqual(await retry(), { outcome: 'in_flight' });
  assert.equal(posts.length, 1);
});

// --- who may retry ---

test('a caller with no account is refused before anything is read', async () => {
  const store = seed(failed());
  answer();
  const raw = { data: { itemId: ITEM } };
  // Boundary cast: a request without auth.
  await assert.rejects(async () => retryArchive.run(raw as unknown as RetryRequest), hasCode('unauthenticated'));
  assertNothingDone(store);
});

for (const data of [undefined, null, 'item1234', {}, { itemId: 5 }, { itemId: '' }, { itemId: 'a/b' }, { itemId: 'a'.repeat(41) }]) {
  test(`a request of ${JSON.stringify(data)} is an invalid argument`, async () => {
    const store = seed(failed());
    answer();
    await assert.rejects(call(data), hasCode('invalid-argument'));
    assertNothingDone(store);
  });
}

const refused: Array<[string, () => ReturnType<typeof seed>, string?]> = [
  ['another user', () => seed(failed()), 'user0002'],
  ['a deleted article', () => seed(failed(), { user: { canonicalId: SHARED, deletedAt: 5 } })],
  ['an article deleted by an older app', () => seed(failed(), { user: { canonicalId: SHARED, deleted_at: 5 } })],
  ['an article the server has not linked', () => seed(failed(), { user: { url: URL } })],
  ['a link that is not an id', () => seed(failed(), { user: { canonicalId: 'a/b' } })],
  ['a link to no shared article', () => seed(undefined)],
  [
    'an unlinked article whose own id is another shared article',
    () => seed(failed(), { user: { url: URL, resolvedId: SHARED }, more: { [ITEM]: failed() } }),
  ],
];

for (const [name, prepare, uid] of refused) {
  test(`${name} is refused with the one message`, async () => {
    const store = prepare();
    answer();
    await assert.rejects(call({ itemId: ITEM }, uid ?? USER), (error: unknown) => {
      hasCode('permission-denied')(error);
      assert.ok(error instanceof HttpsError);
      assert.equal(error.message, 'The article cannot be retried');
      return true;
    });
    assertNothingDone(store);
  });
}

test('an article restored after a delete may be retried', async () => {
  seed(failed(), { user: { canonicalId: SHARED, deletedAt: null } });
  answer(started);
  assert.deepEqual(await retry(), { outcome: 'started' });
});

// --- which articles start nothing ---

const quiet: Array<[string, Doc, string]> = [
  ['a complete archive', { ...failed(), archives: { rendered: { status: 'success' } } }, 'complete'],
  [
    'a complete archive whose stored status still says processing',
    { url: URL, status: 'processing', archives: { monolith: { status: 'success' } } },
    'complete',
  ],
  ['a run in flight', { url: URL, status: 'processing', processing_started_at: ago(MINUTE) }, 'in_flight'],
  [
    'a run in flight whose stored status still says failed',
    { ...failed(), processing_started_at: ago(44 * MINUTE) },
    'in_flight',
  ],
  ['a save that has not started its archive', { url: URL, status: 'pending', archives: {} }, 'not_started'],
  ['bad data', { ...failed(), failure: { class: 'DATA_ISSUE' } }, 'not_retryable'],
  ['no link', { status: 'failed', error: 'boom' }, 'not_retryable'],
  ['a link that is not a web address', { ...failed(), url: 'javascript:alert(1)' }, 'not_retryable'],
  ['a link that does not parse', { ...failed(), url: 'nope' }, 'not_retryable'],
];

for (const [name, shared, outcome] of quiet) {
  test(`${name} answers ${outcome} without a gateway call or a write`, async () => {
    const store = seed(shared);
    answer();
    assert.deepEqual(await retry(), { outcome });
    assertNothingDone(store);
  });
}

// --- which articles start a run ---

const startable: Array<[string, Doc]> = [
  ['a partial archive', { ...failed(), archives: { readability: { status: 'success' } } }],
  ['an abandoned article', { ...failed(), retry_count: 2 }],
  ['a failed article whose run started long ago', { ...failed(), processing_started_at: ago(46 * MINUTE) }],
  ['a run that died with processing stored', { url: URL, status: 'processing', processing_started_at: ago(46 * MINUTE) }],
];

for (const [name, shared] of startable) {
  test(`${name} starts one run`, async () => {
    seed(shared);
    answer(started);
    assert.deepEqual(await retry(), { outcome: 'started' });
    assert.equal(posts.length, 1);
  });
}

test('the link of the shared article is sent, never the one the caller wrote', async () => {
  seed(failed(), { user: { url: 'https://evil.example/x', canonicalId: SHARED, resolvedId: 'other001' } });
  answer(started);
  await retry();
  assert.deepEqual(posts[0]?.body, { url: URL, request_id: SHARED, includeScreenshot: true, includePdf: true });
});

test('a merged duplicate is followed to its winner, which is claimed and sent', async () => {
  const store = seed(
    { ...failed(), mergedInto: 'winner01' },
    { more: { winner01: { ...failed(), url: 'https://example.com/winner' } } }
  );
  answer({ status: 201, body: '{"requestId":"winner01"}' });
  assert.deepEqual(await retry(), { outcome: 'started' });
  assert.deepEqual(posts[0]?.body, {
    url: 'https://example.com/winner',
    request_id: 'winner01',
    includeScreenshot: true,
    includePdf: true,
  });
  assert.deepEqual([...new Set(store.writes.map((w) => w.path))], ['articles/winner01']);
});

// --- a start that does not succeed ---

test('a refusal releases the claim, hides the gateway text and allows the next retry', async () => {
  const prior = ago(60 * MINUTE);
  const store = seed({ ...failed(), processing_started_at: prior });
  answer({ status: 400, body: '{"error":"secret detail","code":"INVALID_OPTIONS"}' }, started);
  assert.deepEqual(await retry(), { outcome: 'not_sent', reason: 'gateway' });
  const doc = store.docs.get(SHARED_PATH);
  assert.equal(doc?.['status'], 'failed');
  assert.equal(doc?.['error'], 'Archive retry refused: 400');
  assert.equal(doc?.['processing_started_at'], prior);
  assert.deepEqual(store.writes[1], {
    method: 'update',
    inTransaction: true,
    path: SHARED_PATH,
    data: {
      status: 'failed',
      error: 'Archive retry refused: 400',
      failed_at: '<timestamp>',
      processing_started_at: '<timestamp>',
    },
    merge: false,
  });
  assert.deepEqual(await retry(), { outcome: 'started' });
});

test('a refusal of an article that never started deletes the claimed start time', async () => {
  const store = seed(failed());
  answer({ status: 502, body: '{"error":"Workflow trigger failed","code":"WORKFLOW_TRIGGER_FAILED"}' });
  assert.deepEqual(await retry(), { outcome: 'not_sent', reason: 'gateway' });
  assert.equal(posts.length, 1);
  assert.deepEqual(store.docs.get(SHARED_PATH)?.['processing_started_at'], firestore.FieldValue.delete());
});

test('a request id the operator owns is released and named', async () => {
  const store = seed(failed());
  answer({ status: 409, body: '{"error":"in use","code":"REQUEST_ID_CONFLICT","id":"shared01"}' });
  assert.deepEqual(await retry(), { outcome: 'not_sent', reason: 'operator_owned' });
  assert.equal(store.docs.get(SHARED_PATH)?.['status'], 'failed');
});

test('a refusal leaves a newer start as it is', async () => {
  const store = seed(failed());
  const newer = firestore.Timestamp.fromMillis(Date.now() + MINUTE);
  answer(() => {
    store.docs.set(SHARED_PATH, { ...failed(), status: 'processing', processing_started_at: newer });
    return new Response('{"code":"INVALID_OPTIONS"}', { status: 400 });
  });
  assert.deepEqual(await retry(), { outcome: 'not_sent', reason: 'gateway' });
  assert.equal(store.writes.length, 1);
  assert.equal(store.docs.get(SHARED_PATH)?.['processing_started_at'], newer);
});

const unclear: Array<[string, () => Response]> = [
  [
    'a timeout',
    () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    },
  ],
  [
    'a dropped connection',
    () => {
      throw new TypeError('fetch failed');
    },
  ],
  ['a server error page the gateway did not write', () => new Response('<html>502</html>', { status: 502 })],
  [
    'an internal error of the gateway',
    () => new Response('{"error":"Internal error","code":"INTERNAL_ERROR"}', { status: 500 }),
  ],
  ['a success that names no run', () => new Response('{}', { status: 200 })],
];

for (const [name, respond] of unclear) {
  test(`${name} is posted once, keeps the claim and answers unconfirmed`, async () => {
    const store = seed(failed());
    answer(respond);
    assert.deepEqual(await retry(), { outcome: 'unconfirmed' });
    assert.equal(posts.length, 1);
    assert.equal(store.writes.length, 1);
    assert.equal(store.docs.get(SHARED_PATH)?.['status'], 'processing');
    assert.deepEqual(await retry(), { outcome: 'in_flight' });
    assert.equal(posts.length, 1);
  });
}

test('a start that cannot be recorded still answers started', async () => {
  const store = seed(failed());
  answer(() => {
    // The record of the start then fails with NOT_FOUND.
    store.docs.delete(SHARED_PATH);
    return new Response(started.body, { status: started.status });
  });
  assert.deepEqual(await retry(), { outcome: 'started' });
  assert.equal(posts.length, 1);
});

test('a missing key fails before anything is claimed', async () => {
  const store = seed(failed());
  answer();
  process.env['PUBLIC_API_KEY'] = '';
  try {
    await assert.rejects(retry(), /PUBLIC_API_KEY is not configured/);
  } finally {
    process.env['PUBLIC_API_KEY'] = 'pk-test';
  }
  assertNothingDone(store);
});

test('the endpoint is callable, declares its keys as secrets and bounds its run', () => {
  const endpoint = retryArchive.__endpoint;
  assert.ok(endpoint.callableTrigger);
  assert.deepEqual((endpoint.secretEnvironmentVariables ?? []).map((s) => s.key).sort(), [
    'CF_ACCESS_CLIENT_ID',
    'CF_ACCESS_CLIENT_SECRET',
    'PUBLIC_API_KEY',
  ]);
  assert.equal(endpoint.timeoutSeconds, 120);
  assert.equal(endpoint.maxInstances, 5);
});
