import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'firebase-functions/v2/https';
import * as firestore from 'firebase-admin/firestore';
import { makeFakeFirestore } from './fake-firestore.js';
import {
  fakeResponse,
  gatewayRequest,
  makeFakeLogGateway,
  makeFakeStorage
} from './handler-fakes.js';

// Drives the deployed entry point, so each call runs the method check, the
// caller key check, the path switch and the handler together. Firestore and
// Cloud Storage are stand-ins; the event log client is real and its POSTs are
// recorded through the global fetch. The clock is fixed.

const NOW = 1_700_000_000_000;
const KEY = 'gcs-k';
const LOG_KEY = 'log-k';
const BUCKET = 'test-bucket';
const ID = 'req-1';
const PATH = `articles/${ID}`;

process.env['ARCHIVE_GATEWAY_KEY'] = KEY;
process.env['GATEWAY_LOG_KEY'] = LOG_KEY;
process.env['CF_ACCESS_CLIENT_ID'] = 'cf-id';
process.env['CF_ACCESS_CLIENT_SECRET'] = 'cf-secret';
process.env['GATEWAY_URL'] = 'https://gateway.test';
process.env['GCS_BUCKET'] = BUCKET;

let fake = makeFakeFirestore();
const storage = makeFakeStorage();

mock.module('firebase-admin/firestore', {
  namedExports: { ...firestore, getFirestore: () => fake.db }
});
mock.module('@google-cloud/storage', {
  namedExports: { Storage: storage.Storage }
});
mock.timers.enable({ apis: ['Date'], now: NOW });

const { archiveGateway } = await import('../index.js');

let logs: ReturnType<typeof makeFakeLogGateway>;

beforeEach(() => {
  fake = makeFakeFirestore();
  storage.reset();
  logs = makeFakeLogGateway();
});

afterEach(() => {
  logs.restore();
});

async function send(req: Request) {
  const { out, res, done } = fakeResponse();
  await archiveGateway(req, res);
  await done;
  return out;
}

function assertNothingTouched() {
  assert.deepEqual(fake.writes, []);
  assert.equal(fake.docs.size, 0);
  assert.deepEqual(storage.state.calls, []);
  assert.deepEqual(logs.state.posts, []);
}

test('a GET answers 405 and touches nothing', async () => {
  const out = await send(gatewayRequest({ method: 'GET', path: '/create-upload', key: KEY }));
  assert.deepEqual(out, { status: 405, body: { error: 'Method not allowed' } });
  assertNothingTouched();
});

const artifact = (kind: string, contentType: string, compressed?: boolean) => ({
  kind,
  filename: kind,
  bytes: 10,
  contentType,
  sha256: 'abc',
  ...(compressed === undefined ? {} : { compressed })
});

const uploadBody = (extra: Record<string, unknown> = {}) => ({
  request_id: ID,
  url: 'https://example.com/a',
  artifacts: [artifact('singlefile.html', 'text/html', true), artifact('page.pdf', 'application/pdf')],
  ...extra
});

const uploaded = (kind: string, gcsPath: string) => ({
  kind,
  gcs_path: gcsPath,
  bytes: 10,
  sha256: 'abc',
  content_type: 'application/octet-stream',
  compressed_size: 4,
  compression_ratio: 0.4
});

const finalizeBody = (extra: Record<string, unknown> = {}) => ({
  request_id: ID,
  firestore_doc_id: ID,
  uploaded: [uploaded('page.pdf', `archives/${ID}/pdf/output.pdf`)],
  ...extra
});

const ROUTES = [
  { path: '/create-upload', body: uploadBody },
  { path: '/finalize', body: finalizeBody }
];

for (const { path, body } of ROUTES) {
  test(`${path} without a caller key answers 401 and touches nothing`, async () => {
    const out = await send(gatewayRequest({ path, body: body() }));
    assert.deepEqual(out, { status: 401, body: { error: 'Unauthorized' } });
    assertNothingTouched();
  });

  test(`${path} with a wrong caller key answers 401 and touches nothing`, async () => {
    const out = await send(gatewayRequest({ path, key: 'wrong-k', body: body() }));
    assert.deepEqual(out, { status: 401, body: { error: 'Unauthorized' } });
    assertNothingTouched();
  });

  test(`${path} with no caller key configured answers 500 and touches nothing`, async () => {
    Reflect.deleteProperty(process.env, 'ARCHIVE_GATEWAY_KEY');
    try {
      const out = await send(gatewayRequest({ path, key: KEY, body: body() }));
      assert.deepEqual(out, { status: 500, body: { error: 'Server misconfigured' } });
      assertNothingTouched();
    } finally {
      process.env['ARCHIVE_GATEWAY_KEY'] = KEY;
    }
  });
}

test('an authorised POST to an unknown path answers 404 and touches nothing', async () => {
  const out = await send(gatewayRequest({ path: '/other', key: KEY, body: uploadBody() }));
  assert.deepEqual(out, { status: 404, body: { error: 'Not found', path: '/other' } });
  assertNothingTouched();
});
