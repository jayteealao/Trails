import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import * as firestore from 'firebase-admin/firestore';
import { makeFakeFirestore } from './fake-firestore.js';

// Pins the writes the archive gateway makes to the shared article document:
// the method, the document, the data and the merge flag of each, in order.
// Firestore, Cloud Storage and the logger are stand-ins; the clock is fixed.

const NOW = 1_700_000_000_000;
const TS = `<ts:${NOW}>`;
const ISO = new Date(NOW).toISOString();
const BUCKET = 'test-bucket';
const ID = 'req-1';
const PATH = `articles/${ID}`;

let fake = makeFakeFirestore();

mock.module('firebase-admin/firestore', {
  namedExports: { ...firestore, getFirestore: () => fake.db }
});
mock.module('@google-cloud/storage', {
  namedExports: {
    Storage: class {
      bucket() {
        return {
          file: (path: string) => ({
            getSignedUrl: async () => [`https://signed.invalid/${path}`]
          })
        };
      }
    }
  }
});
mock.module('../logging.js', {
  namedExports: { logEvent: async () => undefined }
});
mock.timers.enable({ apis: ['Date'], now: NOW });
process.env['GCS_BUCKET'] = BUCKET;

const { handleCreateUpload } = await import('../create-upload.js');
const { handleFinalize } = await import('../finalize.js');

function fakeResponse() {
  const out: { status: number; body: unknown } = { status: 0, body: undefined };
  const res = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      return res;
    }
  };
  return { out, res: res as unknown as Response };
}

async function call(
  handler: (req: Request, res: Response) => Promise<void>,
  body: unknown
): Promise<number> {
  const { out, res } = fakeResponse();
  await handler({ body } as unknown as Request, res);
  return out.status;
}

const artifact = (kind: string, compressed?: boolean) => ({
  kind,
  filename: kind,
  bytes: 10,
  contentType: 'application/octet-stream',
  sha256: 'abc',
  ...(compressed === undefined ? {} : { compressed })
});

const uploading = (folder: string, filename: string) => ({
  status: 'uploading',
  gcs_path: `gs://${BUCKET}/archives/${ID}/${folder}/${filename}`,
  gcs_bucket: BUCKET,
  started_at: ISO
});

test('create-upload on a new article merge-sets the doc with created_at and an uploading entry per archive kind', async () => {
  fake = makeFakeFirestore();
  const status = await call(handleCreateUpload, {
    request_id: ID,
    url: 'https://example.com/a',
    artifacts: [
      artifact('singlefile.html', true),
      artifact('page.pdf'),
      artifact('manifest.json')
    ]
  });
  assert.equal(status, 200);
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
        archives: {
          singlefile: uploading('singlefile', 'output.html.gz'),
          pdf: uploading('pdf', 'output.pdf')
        },
        created_at: TS
      }
    }
  ]);
});

test('create-upload on an existing article keeps a success entry whole and spreads a failed one', async () => {
  const success = {
    status: 'success',
    gcs_path: 'gs://old/singlefile',
    gcs_bucket: 'old',
    created_at: '2020-01-01T00:00:00.000Z'
  };
  fake = makeFakeFirestore({
    [PATH]: {
      item_id: ID,
      archives: {
        singlefile: success,
        pdf: { status: 'failed', error: 'boom' }
      }
    }
  });
  const status = await call(handleCreateUpload, {
    request_id: ID,
    url: 'not a url',
    artifacts: [artifact('singlefile.html', true), artifact('page.pdf')]
  });
  assert.equal(status, 200);
  assert.deepEqual(fake.writes, [
    {
      method: 'set',
      path: PATH,
      merge: true,
      data: {
        item_id: ID,
        url: 'not a url',
        domain: 'unknown',
        updated_at: TS,
        archives: {
          singlefile: success,
          pdf: { error: 'boom', ...uploading('pdf', 'output.pdf') }
        }
      }
    }
  ]);
});

test('create-upload without artifacts answers 400 and writes nothing', async () => {
  fake = makeFakeFirestore();
  const status = await call(handleCreateUpload, { request_id: ID, url: 'https://example.com/a' });
  assert.equal(status, 400);
  assert.deepEqual(fake.writes, []);
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

const success = (gcsPath: string) => ({
  status: 'success',
  gcs_path: `gs://${BUCKET}/${gcsPath}`,
  gcs_bucket: BUCKET,
  compressed_size: 4,
  compression_ratio: 0.4,
  created_at: ISO
});

const METADATA = {
  byline: 'A. Writer',
  excerpt: 'An excerpt',
  published_time: null,
  site_name: 'Example',
  title: 'A title',
  word_count: 120,
  lead_image: null
};

const finalizeBody = (extra: Record<string, unknown>) => ({
  request_id: ID,
  firestore_doc_id: ID,
  ...extra
});

test('finalize updates the dotted archive entries, updated_at, metadata and images', async () => {
  fake = makeFakeFirestore({ [PATH]: { item_id: ID } });
  const images = [{ src: 'https://example.com/i.png', width: 10 }];
  const status = await call(
    handleFinalize,
    finalizeBody({
      uploaded: [
        uploaded('rendered.html', 'archives/req-1/rendered/output.html.gz'),
        uploaded('screenshot.png', 'archives/req-1/screenshot/output.png')
      ],
      metadata: METADATA,
      images
    })
  );
  assert.equal(status, 200);
  assert.deepEqual(fake.writes, [
    {
      method: 'update',
      path: PATH,
      merge: false,
      data: {
        'archives.rendered': success('archives/req-1/rendered/output.html.gz'),
        'archives.screenshot': success('archives/req-1/screenshot/output.png'),
        updated_at: TS,
        metadata: METADATA,
        images
      }
    }
  ]);
});

test('finalize with no uploads and metadata only updates updated_at and metadata', async () => {
  fake = makeFakeFirestore({ [PATH]: { item_id: ID } });
  const status = await call(handleFinalize, finalizeBody({ uploaded: [], metadata: METADATA }));
  assert.equal(status, 200);
  assert.deepEqual(fake.writes, [
    { method: 'update', path: PATH, merge: false, data: { updated_at: TS, metadata: METADATA } }
  ]);
});

test('finalize of a kind with no archive entry and no metadata updates only updated_at', async () => {
  fake = makeFakeFirestore({ [PATH]: { item_id: ID } });
  const status = await call(
    handleFinalize,
    finalizeBody({ uploaded: [uploaded('readability.json', 'archives/req-1/readability/output.json')] })
  );
  assert.equal(status, 200);
  assert.deepEqual(fake.writes, [
    { method: 'update', path: PATH, merge: false, data: { updated_at: TS } }
  ]);
});

test('finalize of a missing article attempts the update and answers 500', async () => {
  fake = makeFakeFirestore();
  const status = await call(handleFinalize, finalizeBody({ uploaded: [] }));
  assert.equal(status, 500);
  assert.deepEqual(fake.writes, [
    { method: 'update', path: PATH, merge: false, data: { updated_at: TS } }
  ]);
  assert.equal(fake.docs.has(PATH), false);
});
