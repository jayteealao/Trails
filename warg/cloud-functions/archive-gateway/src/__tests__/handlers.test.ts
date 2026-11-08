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
