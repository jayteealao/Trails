import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'firebase-functions/v2/https';
import * as firestore from 'firebase-admin/firestore';
import { SHARED_ARTICLE_FIELDS } from '@warg/article-writer';
import { makeFakeFirestore, normalise } from './fake-firestore.js';
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

test('create-upload still answers and journals when the event log cannot be reached', async () => {
  logs.state.mode = 'reject';
  const out = await send(gatewayRequest({ path: '/create-upload', key: KEY, body: FULL_UPLOAD }));
  assert.deepEqual(out, UPLOAD_ANSWER);
  assert.deepEqual(fake.writes, UPLOAD_JOURNAL);
  assert.deepEqual(storage.state.calls, UPLOAD_SIGNING);
  assert.deepEqual(logs.state.posts, UPLOAD_LOGS);
});

test('create-upload still answers when the event log refuses an event, and does not resend it', async () => {
  logs.state.mode = 400;
  const out = await send(gatewayRequest({ path: '/create-upload', key: KEY, body: FULL_UPLOAD }));
  assert.deepEqual(out, UPLOAD_ANSWER);
  assert.deepEqual(fake.writes, UPLOAD_JOURNAL);
  assert.deepEqual(logs.state.posts, UPLOAD_LOGS);
});

test('create-upload answers 500 when signing fails, keeps the journal and logs the failure', async () => {
  // The page.pdf upload is the one stored under /pdf/.
  storage.state.failOn = '/pdf/';
  const body = uploadBody();
  const message = `signing failed: archives/${ID}/pdf/output.pdf`;
  const out = await send(gatewayRequest({ path: '/create-upload', key: KEY, body }));
  assert.deepEqual(out, { status: 500, body: { error: 'Internal error', message } });
  assert.deepEqual(fake.writes, [
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
          pdf: journalEntry('pdf', 'output.pdf')
        }
      }
    }
  ]);
  assert.deepEqual(logs.state.posts, [
    logPost('persist.started', 'Creating signed upload URLs', { artifactCount: 2 }),
    logPost(
      'persist.failed',
      `Failed to create upload URLs: ${message}`,
      { error: message },
      'error'
    )
  ]);
});

const BAD_FINALIZE_BODIES: Array<[string, Record<string, unknown>]> = [
  ['no firestore_doc_id', finalizeBody({ firestore_doc_id: undefined })],
  ['uploaded that is not a list', finalizeBody({ uploaded: 'page.pdf' })]
];

for (const [name, body] of BAD_FINALIZE_BODIES) {
  test(`finalize with ${name} answers 400 and touches nothing`, async () => {
    const out = await send(gatewayRequest({ path: '/finalize', key: KEY, body }));
    assert.deepEqual(out, {
      status: 400,
      body: { error: 'Missing required fields: request_id, firestore_doc_id, uploaded' }
    });
    assertNothingTouched();
  });
}

const METADATA = {
  byline: 'A. Writer',
  excerpt: 'An excerpt',
  published_time: null,
  site_name: 'Example',
  title: 'A title',
  word_count: 120,
  lead_image: null
};
const IMAGES = [{ src: 'https://example.com/i.png', width: 10 }];

const SINGLEFILE_PATH = `archives/${ID}/singlefile/output.html.gz`;
const PDF_PATH = `archives/${ID}/pdf/output.pdf`;

const FULL_FINALIZE = finalizeBody({
  uploaded: [uploaded('singlefile.html', SINGLEFILE_PATH), uploaded('page.pdf', PDF_PATH)],
  metadata: METADATA,
  images: IMAGES
});

const seededArticle = () => ({
  [PATH]: {
    item_id: ID,
    url: 'https://example.com/a',
    archives: {
      singlefile: journalEntry('singlefile', 'output.html.gz'),
      pdf: journalEntry('pdf', 'output.pdf')
    }
  }
});

const stored = (gcsPath: string) => ({
  status: 'success',
  gcs_path: `gs://${BUCKET}/${gcsPath}`,
  gcs_bucket: BUCKET,
  compressed_size: 4,
  compression_ratio: 0.4,
  created_at: ISO
});

const FINALIZE_UPDATE = [
  {
    method: 'update',
    path: PATH,
    merge: false,
    data: {
      'archives.singlefile': stored(SINGLEFILE_PATH),
      'archives.pdf': stored(PDF_PATH),
      updated_at: TS,
      metadata: METADATA,
      images: IMAGES
    }
  }
];

const FINALIZE_ANSWER = { status: 200, body: { success: true, firestore_doc_id: ID, status: 'done' } };

test('finalize of a journalled article marks each archive stored with its path and logs the end', async () => {
  fake = makeFakeFirestore(seededArticle());
  const out = await send(gatewayRequest({ path: '/finalize', key: KEY, body: FULL_FINALIZE }));
  assert.deepEqual(out, FINALIZE_ANSWER);
  assert.deepEqual(fake.writes, FINALIZE_UPDATE);
  for (const write of fake.writes) assertCanonicalFields(write.data);
  // The dotted update replaces each entry whole, so the journal's started_at is gone.
  assert.deepEqual(normalise(fake.docs.get(PATH)), {
    item_id: ID,
    url: 'https://example.com/a',
    archives: { singlefile: stored(SINGLEFILE_PATH), pdf: stored(PDF_PATH) },
    updated_at: TS,
    metadata: METADATA,
    images: IMAGES
  });
  assert.deepEqual(logs.state.posts, [
    logPost('persist.completed', 'Firestore finalized', { firestoreDocId: ID, artifactCount: 2 })
  ]);
});

test('finalize still answers and updates when the event log cannot be reached', async () => {
  fake = makeFakeFirestore(seededArticle());
  logs.state.mode = 'reject';
  const out = await send(gatewayRequest({ path: '/finalize', key: KEY, body: FULL_FINALIZE }));
  assert.deepEqual(out, FINALIZE_ANSWER);
  assert.deepEqual(fake.writes, FINALIZE_UPDATE);
});

test('finalize answers 500 when the article update fails for another reason', async () => {
  fake = makeFakeFirestore(seededArticle());
  const real = fake.db;
  fake.db = {
    collection: (name: string) => ({
      doc: (id: string) => ({
        ...real.collection(name).doc(id),
        update: async () => {
          throw new Error('boom');
        }
      })
    })
  };
  const out = await send(gatewayRequest({ path: '/finalize', key: KEY, body: FULL_FINALIZE }));
  assert.deepEqual(out, { status: 500, body: { error: 'Internal error', message: 'boom' } });
  assert.deepEqual(logs.state.posts, [
    logPost('persist.failed', 'Failed to finalize: boom', { error: 'boom' }, 'error')
  ]);
});

test('finalize of an unknown article answers 404, creates nothing and logs the failure', async () => {
  const out = await send(gatewayRequest({ path: '/finalize', key: KEY, body: finalizeBody() }));
  assert.deepEqual(out, {
    status: 404,
    body: { error: 'Article not found', firestore_doc_id: ID }
  });
  assert.deepEqual(fake.writes, [
    {
      method: 'update',
      path: PATH,
      merge: false,
      data: { 'archives.pdf': stored(PDF_PATH), updated_at: TS }
    }
  ]);
  assert.equal(fake.docs.has(PATH), false);
  const message = `5 NOT_FOUND: No document to update: ${PATH}`;
  assert.deepEqual(logs.state.posts, [
    logPost('persist.failed', `Failed to finalize: ${message}`, { error: message }, 'error')
  ]);
});
