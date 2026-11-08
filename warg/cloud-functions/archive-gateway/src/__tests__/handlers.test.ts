import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'firebase-functions/v2/https';
import * as firestore from 'firebase-admin/firestore';
import { SHARED_ARTICLE_FIELDS } from '@warg/article-writer';
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

const BAD_UPLOAD_BODIES: Array<[string, Record<string, unknown>]> = [
  ['no request_id', uploadBody({ request_id: undefined })],
  ['no url', uploadBody({ url: undefined })],
  ['artifacts that is not a list', uploadBody({ artifacts: 'singlefile.html' })]
];

for (const [name, body] of BAD_UPLOAD_BODIES) {
  test(`create-upload with ${name} answers 400 and touches nothing`, async () => {
    const out = await send(gatewayRequest({ path: '/create-upload', key: KEY, body }));
    assert.deepEqual(out, {
      status: 400,
      body: { error: 'Missing required fields: request_id, url, artifacts' }
    });
    assertNothingTouched();
  });
}

const TS = `<ts:${NOW}>`;
const ISO = new Date(NOW).toISOString();
const EXPIRES = new Date(NOW + 15 * 60_000);

const LOG_HEADERS = {
  'Content-Type': 'application/json',
  'X-Internal-API-Key': LOG_KEY,
  'CF-Access-Client-Id': 'cf-id',
  'CF-Access-Client-Secret': 'cf-secret'
};

const logPost = (
  type: string,
  message: string,
  data: Record<string, unknown>,
  level = 'info'
) => ({
  url: 'https://gateway.test/internal/log',
  headers: LOG_HEADERS,
  body: { requestId: ID, event: { ts: ISO, source: 'gcs', type, level, message, data } }
});

// Every field path a write names: each key, and each field of a map below it.
function writtenFieldPaths(data: unknown, prefix = ''): string[] {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return [];
  return Object.entries(data).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return [path, ...writtenFieldPaths(value, path)];
  });
}

function assertCanonicalFields(data: unknown) {
  const known = new Set<string>(SHARED_ARTICLE_FIELDS);
  const unknown = writtenFieldPaths(data).filter((path) => !known.has(path));
  assert.deepEqual(unknown, []);
}

const journalEntry = (folder: string, filename: string) => ({
  status: 'uploading',
  gcs_path: `gs://${BUCKET}/archives/${ID}/${folder}/${filename}`,
  gcs_bucket: BUCKET,
  started_at: ISO
});

const FULL_UPLOAD = uploadBody({
  artifacts: [
    artifact('singlefile.html', 'text/html', true),
    artifact('page.pdf', 'application/pdf'),
    artifact('rendered.md', 'text/markdown', true),
    artifact('manifest.json', 'application/json')
  ]
});

const UPLOAD_PATHS: Array<[string, string]> = [
  ['singlefile.html', `archives/${ID}/singlefile/output.html.gz`],
  ['page.pdf', `archives/${ID}/pdf/output.pdf`],
  ['rendered.md', `archives/${ID}/rendered/output.md.gz`],
  ['manifest.json', `archives/${ID}/manifest/manifest.json`]
];

const UPLOAD_ANSWER = {
  status: 200,
  body: {
    firestore_doc_id: ID,
    uploads: UPLOAD_PATHS.map(([kind, gcsPath]) => ({
      kind,
      signed_url: `https://signed.invalid/${gcsPath}`,
      gcs_path: gcsPath,
      expires_at: EXPIRES.toISOString()
    }))
  }
};

const UPLOAD_JOURNAL = [
  {
    method: 'set',
    path: PATH,
    merge: true,
    data: {
      item_id: ID,
      url: 'https://example.com/a',
      domain: 'example.com',
      updated_at: TS,
      created_at: TS,
      archives: {
        singlefile: journalEntry('singlefile', 'output.html.gz'),
        pdf: journalEntry('pdf', 'output.pdf'),
        markdown: journalEntry('rendered', 'output.md.gz')
      }
    }
  }
];

const signed = (gcsPath: string, contentType: string, compressed: boolean) => ({
  bucket: BUCKET,
  path: gcsPath,
  opts: {
    version: 'v4',
    action: 'write',
    expires: EXPIRES,
    contentType,
    ...(compressed ? { extensionHeaders: { 'content-encoding': 'gzip' } } : {})
  }
});

const UPLOAD_SIGNING = [
  signed(`archives/${ID}/singlefile/output.html.gz`, 'text/html', true),
  signed(`archives/${ID}/pdf/output.pdf`, 'application/pdf', false),
  signed(`archives/${ID}/rendered/output.md.gz`, 'text/markdown', true),
  signed(`archives/${ID}/manifest/manifest.json`, 'application/json', false)
];

const UPLOAD_LOGS = [
  logPost('persist.started', 'Creating signed upload URLs', { artifactCount: 4 }),
  logPost('persist.completed', 'Signed URLs created', { firestoreDocId: ID, uploadCount: 4 })
];

test('create-upload of a new article journals the canonical fields, signs each upload and logs start and end', async () => {
  const out = await send(gatewayRequest({ path: '/create-upload', key: KEY, body: FULL_UPLOAD }));
  assert.deepEqual(out, UPLOAD_ANSWER);
  assert.deepEqual(fake.writes, UPLOAD_JOURNAL);
  for (const write of fake.writes) assertCanonicalFields(write.data);
  assert.deepEqual(storage.state.calls, UPLOAD_SIGNING);
  assert.deepEqual(logs.state.posts, UPLOAD_LOGS);
});
