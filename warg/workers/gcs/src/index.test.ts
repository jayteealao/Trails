import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveManifest, ArtifactKind } from '@warg/shared';
import { getGcsPath } from '@warg/shared';
import worker from './index.js';
import type { PersistResponse } from './types.js';

const REQUEST_ID = 'req-1';
const MANIFEST_KEY = `archives/${REQUEST_ID}/manifest.json`;
const FN_BASE = 'https://fn.test/archive-gateway';
const DOC_ID = 'doc-1';

// The GCS paths the archive-gateway function hands back, written out literally
// so these tests do not depend on where the worker computes them.
const GCS_PATHS: Partial<Record<ArtifactKind, string>> = {
  'page.pdf': `archives/${REQUEST_ID}/pdf/output.pdf`,
  'screenshot.png': `archives/${REQUEST_ID}/screenshot/output.png`,
  'singlefile.html': `archives/${REQUEST_ID}/singlefile/output.html.gz`
};

const R2_KEYS: Partial<Record<ArtifactKind, string>> = {
  'page.pdf': `archives/${REQUEST_ID}/raw/page.pdf`,
  'screenshot.png': `archives/${REQUEST_ID}/raw/screenshot.png`,
  'singlefile.html': `archives/${REQUEST_ID}/derived/singlefile.html`,
  'manifest.json': MANIFEST_KEY
};

const CONTENT_TYPES: Partial<Record<ArtifactKind, string>> = {
  'page.pdf': 'application/pdf',
  'screenshot.png': 'image/png',
  'singlefile.html': 'text/html',
  'manifest.json': 'application/json'
};

/** The bytes each artifact holds in the fake R2 bucket. */
const ARTIFACT_BODIES: Partial<Record<ArtifactKind, string>> = {
  'page.pdf': '%PDF-1.7 fake pdf bytes',
  'screenshot.png': 'fake png bytes',
  'singlefile.html': `<html><body>${'archived page '.repeat(50)}</body></html>`
};

function makeBucket(objects: Record<string, string | object>) {
  const reads: string[] = [];
  return {
    reads,
    async get(key: string) {
      reads.push(key);
      const value = objects[key];
      if (value === undefined) return null;
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      const bytes = new TextEncoder().encode(text);
      return {
        async arrayBuffer() {
          return bytes.slice().buffer;
        },
        async json() {
          return JSON.parse(text);
        }
      };
    }
  };
}

type FakeBucket = ReturnType<typeof makeBucket>;

function makeEnv(bucket: FakeBucket): Env {
  return {
    // The fake implements only the `get` the handler calls; the cast stays at
    // this test boundary.
    ARCHIVE_BUCKET: bucket as unknown as R2Bucket,
    INTERNAL_API_KEY: 'in-k',
    ARCHIVE_GATEWAY_KEY: 'gw-k',
    CLOUD_FN_BASE_URL: FN_BASE
  };
}

// The handler never touches its execution context; the cast stays at this
// test boundary.
const ctx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
  exports: {}
} as unknown as ExecutionContext;

function persistRequest(
  body: unknown,
  { key = 'in-k', method = 'POST', path = '/persist' }: { key?: string | null; method?: string; path?: string } = {}
): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key !== null) headers['X-Internal-API-Key'] = key;
  return new Request(`https://gcs${path}`, {
    method,
    headers,
    ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) })
  });
}

function manifest(kinds: ArtifactKind[]): ArchiveManifest {
  return {
    requestId: REQUEST_ID,
    url: 'https://example.com/article',
    createdAt: '2026-11-08T00:00:00Z',
    completedAt: '2026-11-08T00:01:00Z',
    artifacts: kinds.map((kind) => ({
      kind,
      r2Key: R2_KEYS[kind] ?? `archives/${REQUEST_ID}/raw/${kind}`,
      bytes: new TextEncoder().encode(ARTIFACT_BODIES[kind] ?? '').byteLength,
      sha256: `sha-${kind}`,
      contentType: CONTENT_TYPES[kind] ?? 'application/octet-stream'
    }))
  };
}

/** R2 objects for a manifest: the manifest itself plus the bytes of each artifact. */
function bucketFor(m: ArchiveManifest, omit: ArtifactKind[] = []): FakeBucket {
  const objects: Record<string, string | object> = { [MANIFEST_KEY]: m };
  for (const a of m.artifacts) {
    const body = ARTIFACT_BODIES[a.kind];
    if (body !== undefined && !omit.includes(a.kind)) objects[a.r2Key] = body;
  }
  return makeBucket(objects);
}

interface NetworkCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** Parsed JSON for a cloud-function call; raw bytes for a signed-URL PUT. */
  json?: unknown;
  bytes?: ArrayBuffer;
}

interface CreateUploadBody {
  request_id: string;
  artifacts: Array<{ kind: ArtifactKind; compressed?: boolean }>;
}

interface NetworkOverrides {
  createUpload?: (body: CreateUploadBody) => Response;
  finalize?: (body: { uploaded: Array<{ kind: ArtifactKind }> }) => Response;
  put?: (kind: string) => Response;
}

/**
 * Stub global fetch with one router: the archive-gateway function's
 * /create-upload and /finalize, and the signed-URL PUT of each artifact
 * (https://upload.test/<kind>). Returns the log of every call, in order.
 */
function stubNetwork(overrides: NetworkOverrides = {}): NetworkCall[] {
  const calls: NetworkCall[] = [];
  const router = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    // Both call sites pass headers as a plain object.
    const headers = { ...(init?.headers as Record<string, string> | undefined) };

    if (url.startsWith('https://upload.test/')) {
      // The handler PUTs an ArrayBuffer body.
      calls.push({ url, method, headers, bytes: init?.body as ArrayBuffer });
      const kind = decodeURIComponent(url.slice('https://upload.test/'.length));
      return overrides.put?.(kind) ?? new Response(null, { status: 200 });
    }

    const json: unknown = JSON.parse(String(init?.body));
    calls.push({ url, method, headers, json });

    if (url === `${FN_BASE}/create-upload`) {
      const body = json as CreateUploadBody;
      if (overrides.createUpload) return overrides.createUpload(body);
      return Response.json({
        firestore_doc_id: DOC_ID,
        uploads: body.artifacts.map((a) => ({
          kind: a.kind,
          signed_url: `https://upload.test/${a.kind}`,
          gcs_path: GCS_PATHS[a.kind] ?? `archives/${body.request_id}/${a.kind}`,
          expires_at: '2026-11-08T01:00:00Z'
        }))
      });
    }

    if (url === `${FN_BASE}/finalize`) {
      const body = json as { uploaded: Array<{ kind: ArtifactKind }> };
      if (overrides.finalize) return overrides.finalize(body);
      return Response.json({ success: true, firestore_doc_id: DOC_ID, status: 'complete' });
    }

    throw new Error(`unexpected fetch: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', router);
  return calls;
}

async function run(request: Request, bucket: FakeBucket): Promise<{ status: number; body: unknown }> {
  const response = await worker.fetch(request, makeEnv(bucket), ctx);
  return { status: response.status, body: await response.json() };
}

const validBody = { request_id: REQUEST_ID, manifest_key: MANIFEST_KEY };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('401', () => {
  it.each([
    ['no key header', null],
    ['a wrong key', 'nope']
  ])('answers 401 for %s and touches neither R2 nor GCS', async (_label, key) => {
    const bucket = bucketFor(manifest(['page.pdf']));
    const calls = stubNetwork();

    const result = await run(persistRequest(validBody, { key }), bucket);

    expect(result).toEqual({ status: 401, body: { error: 'Unauthorized' } });
    expect(bucket.reads).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('404', () => {
  it('answers 404 for GET /persist even with a valid key', async () => {
    const bucket = bucketFor(manifest(['page.pdf']));
    const calls = stubNetwork();

    const result = await run(persistRequest(validBody, { method: 'GET' }), bucket);

    expect(result).toEqual({ status: 404, body: { error: 'Not found' } });
    expect(bucket.reads).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('answers 404 for an unknown path before it checks the key', async () => {
    const bucket = bucketFor(manifest(['page.pdf']));
    const calls = stubNetwork();

    const result = await run(persistRequest(validBody, { key: null, path: '/other' }), bucket);

    expect(result).toEqual({ status: 404, body: { error: 'Not found' } });
    expect(bucket.reads).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('parsing', () => {
  it('answers 400 for a body that is not JSON', async () => {
    const bucket = bucketFor(manifest(['page.pdf']));
    const calls = stubNetwork();

    const result = await run(persistRequest('{not json'), bucket);

    expect(result).toEqual({ status: 400, body: { error: 'Invalid JSON' } });
    expect(bucket.reads).toEqual([]);
    expect(calls).toEqual([]);
  });

  it.each([
    ['request_id', { manifest_key: MANIFEST_KEY }],
    ['manifest_key', { request_id: REQUEST_ID }]
  ])('answers 400 when %s is missing', async (_field, body) => {
    const bucket = bucketFor(manifest(['page.pdf']));
    const calls = stubNetwork();

    const result = await run(persistRequest(body), bucket);

    expect(result).toEqual({
      status: 400,
      body: { error: 'Missing required fields: request_id, manifest_key' }
    });
    expect(bucket.reads).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('answers 404 with the key when R2 does not hold the manifest', async () => {
    const bucket = makeBucket({});
    const calls = stubNetwork();

    const result = await run(persistRequest(validBody), bucket);

    expect(result).toEqual({
      status: 404,
      body: { error: 'Manifest not found in R2', key: MANIFEST_KEY }
    });
    expect(bucket.reads).toEqual([MANIFEST_KEY]);
    expect(calls).toEqual([]);
  });
});

const THREE_KINDS: ArtifactKind[] = ['page.pdf', 'screenshot.png', 'singlefile.html', 'manifest.json'];

async function gunzip(bytes: ArrayBuffer): Promise<string> {
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

/** `<METHOD> <url>` plus the kinds a finalize call carries, for order checks. */
function summarize(calls: NetworkCall[]): string[] {
  return calls.map((c) => {
    if (c.url === `${FN_BASE}/finalize`) {
      const kinds = (c.json as { uploaded: Array<{ kind: string }> }).uploaded.map((u) => u.kind);
      return `finalize [${kinds.join(',')}]`;
    }
    if (c.url === `${FN_BASE}/create-upload`) return 'create-upload';
    return `${c.method} ${c.url}`;
  });
}

describe('success', () => {
  it('uploads three artifacts and answers a gcs_path for each in the documented shape', async () => {
    const m = manifest(THREE_KINDS);
    const bucket = bucketFor(m);
    const calls = stubNetwork();

    const result = await run(persistRequest(validBody), bucket);

    expect(summarize(calls)).toEqual([
      'create-upload',
      'PUT https://upload.test/page.pdf',
      'finalize [page.pdf]',
      'PUT https://upload.test/screenshot.png',
      'finalize [screenshot.png]',
      'PUT https://upload.test/singlefile.html',
      'finalize [singlefile.html]',
      'finalize []'
    ]);

    const createUpload = calls[0]!;
    expect(createUpload.headers['X-Internal-API-Key']).toBe('gw-k');
    const listed = (createUpload.json as CreateUploadBody).artifacts;
    expect(listed.map((a) => a.kind)).toEqual(['page.pdf', 'screenshot.png', 'singlefile.html']);
    expect(listed.filter((a) => a.compressed === true).map((a) => a.kind)).toEqual(['singlefile.html']);

    const puts = calls.filter((c) => c.method === 'PUT');
    const putOf = (kind: string) => puts.find((c) => c.url === `https://upload.test/${kind}`)!;
    expect(putOf('singlefile.html').headers['content-encoding']).toBe('gzip');
    expect(await gunzip(putOf('singlefile.html').bytes!)).toBe(ARTIFACT_BODIES['singlefile.html']);
    expect(putOf('page.pdf').headers['content-encoding']).toBeUndefined();
    expect(putOf('screenshot.png').headers['content-encoding']).toBeUndefined();
    expect(new TextDecoder().decode(putOf('page.pdf').bytes!)).toBe(ARTIFACT_BODIES['page.pdf']);

    const singlefileBytes = m.artifacts.find((a) => a.kind === 'singlefile.html')!.bytes;
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      success: true,
      firestore_doc_id: DOC_ID,
      uploaded: 3,
      artifacts: [
        { kind: 'page.pdf', gcs_path: 'archives/req-1/pdf/output.pdf' },
        { kind: 'screenshot.png', gcs_path: 'archives/req-1/screenshot/output.png' },
        { kind: 'singlefile.html', gcs_path: 'archives/req-1/singlefile/output.html.gz' }
      ],
      meta: {
        compressionStats: [
          {
            kind: 'singlefile.html',
            originalBytes: singlefileBytes,
            compressedBytes: expect.any(Number),
            ratio: expect.any(Number)
          }
        ],
        uploadDurationMs: expect.any(Number),
        skippedArtifacts: []
      }
    } satisfies PersistResponse);
  });
});

describe('edges', () => {
  it('answers 200 with nothing uploaded when the manifest lists only itself', async () => {
    const bucket = bucketFor(manifest(['manifest.json']));
    const calls = stubNetwork();

    const result = await run(persistRequest(validBody), bucket);

    expect(result).toEqual({
      status: 200,
      body: { success: true, firestore_doc_id: REQUEST_ID, uploaded: 0, artifacts: [] }
    });
    expect(calls).toEqual([]);
  });

  it('answers the paths without reading artifacts or calling out on a dry run', async () => {
    const bucket = bucketFor(manifest(THREE_KINDS));
    const calls = stubNetwork();

    const result = await run(persistRequest({ ...validBody, dryRun: true }), bucket);

    expect(result).toEqual({
      status: 200,
      body: {
        success: true,
        firestore_doc_id: REQUEST_ID,
        uploaded: 3,
        artifacts: [
          { kind: 'page.pdf', gcs_path: 'archives/req-1/pdf/output.pdf' },
          { kind: 'screenshot.png', gcs_path: 'archives/req-1/screenshot/output.png' },
          { kind: 'singlefile.html', gcs_path: 'archives/req-1/singlefile/output.html.gz' }
        ],
        dryRun: true
      }
    });
    expect(bucket.reads).toEqual([MANIFEST_KEY]);
    expect(calls).toEqual([]);
  });

  it('skips a non-compressible artifact that got no signed upload and uploads the rest', async () => {
    const bucket = bucketFor(manifest(THREE_KINDS));
    const calls = stubNetwork({
      createUpload: (body) =>
        Response.json({
          firestore_doc_id: DOC_ID,
          uploads: body.artifacts
            .filter((a) => a.kind !== 'screenshot.png')
            .map((a) => ({
              kind: a.kind,
              signed_url: `https://upload.test/${a.kind}`,
              gcs_path: GCS_PATHS[a.kind],
              expires_at: '2026-11-08T01:00:00Z'
            }))
        })
    });

    const result = await run(persistRequest(validBody), bucket);

    expect(summarize(calls)).toEqual([
      'create-upload',
      'PUT https://upload.test/page.pdf',
      'finalize [page.pdf]',
      'PUT https://upload.test/singlefile.html',
      'finalize [singlefile.html]',
      'finalize []'
    ]);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      success: true,
      uploaded: 2,
      artifacts: [
        { kind: 'page.pdf', gcs_path: 'archives/req-1/pdf/output.pdf' },
        { kind: 'singlefile.html', gcs_path: 'archives/req-1/singlefile/output.html.gz' }
      ],
      meta: { skippedArtifacts: ['screenshot.png'] }
    });
  });

  it('keeps an artifact whose own finalize fails and still answers 200', async () => {
    const bucket = bucketFor(manifest(THREE_KINDS));
    const calls = stubNetwork({
      finalize: (body) =>
        body.uploaded.some((u) => u.kind === 'screenshot.png')
          ? new Response('firestore down', { status: 500 })
          : Response.json({ success: true, firestore_doc_id: DOC_ID, status: 'complete' })
    });

    const result = await run(persistRequest(validBody), bucket);

    expect(summarize(calls)).toContain('finalize []');
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      success: true,
      uploaded: 3,
      artifacts: [
        { kind: 'page.pdf', gcs_path: 'archives/req-1/pdf/output.pdf' },
        { kind: 'screenshot.png', gcs_path: 'archives/req-1/screenshot/output.png' },
        { kind: 'singlefile.html', gcs_path: 'archives/req-1/singlefile/output.html.gz' }
      ]
    });
  });
});

describe('signed-url', () => {
  it('answers 500 and uploads nothing when /create-upload fails', async () => {
    const bucket = bucketFor(manifest(THREE_KINDS));
    const calls = stubNetwork({
      createUpload: () => new Response('signer down', { status: 500 })
    });

    const result = await run(persistRequest(validBody), bucket);

    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      error: 'Internal error',
      message: expect.stringContaining('Cloud Function /create-upload failed: 500')
    });
    expect(summarize(calls)).toEqual(['create-upload']);
  });

  it('answers 500 for contract drift when a compressible artifact gets a non-.gz path', async () => {
    const bucket = bucketFor(manifest(THREE_KINDS));
    const calls = stubNetwork({
      createUpload: (body) =>
        Response.json({
          firestore_doc_id: DOC_ID,
          uploads: body.artifacts.map((a) => ({
            kind: a.kind,
            signed_url: `https://upload.test/${a.kind}`,
            gcs_path:
              a.kind === 'singlefile.html' ? 'archives/req-1/singlefile/output.html' : GCS_PATHS[a.kind],
            expires_at: '2026-11-08T01:00:00Z'
          }))
        })
    });

    const result = await run(persistRequest(validBody), bucket);

    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      error: 'Internal error',
      message: expect.stringContaining('Contract drift')
    });
    expect(summarize(calls)).toEqual(['create-upload']);
  });
});

describe('partial', () => {
  it('reports a failed upload per artifact, still uploads the others, and answers 502', async () => {
    const bucket = bucketFor(manifest(THREE_KINDS));
    const calls = stubNetwork({
      put: (kind) => (kind === 'screenshot.png' ? new Response('gcs down', { status: 500 }) : new Response(null))
    });

    const result = await run(persistRequest(validBody), bucket);

    // Every artifact is tried; only the uploaded ones are finalized, and the
    // metadata finalize is skipped so the retry writes it.
    expect(summarize(calls)).toEqual([
      'create-upload',
      'PUT https://upload.test/page.pdf',
      'finalize [page.pdf]',
      'PUT https://upload.test/screenshot.png',
      'PUT https://upload.test/singlefile.html',
      'finalize [singlefile.html]'
    ]);
    expect(result).toEqual({
      status: 502,
      body: {
        error: 'Upload failed for some artifacts',
        firestore_doc_id: DOC_ID,
        uploaded: 2,
        artifacts: [
          { kind: 'page.pdf', gcs_path: 'archives/req-1/pdf/output.pdf' },
          { kind: 'singlefile.html', gcs_path: 'archives/req-1/singlefile/output.html.gz' }
        ],
        failed: [
          {
            kind: 'screenshot.png',
            error: expect.stringContaining('GCS upload failed for screenshot.png: 500')
          }
        ]
      }
    });
  });

  it('reports an artifact missing from R2 and still uploads the others', async () => {
    const bucket = bucketFor(manifest(THREE_KINDS), ['page.pdf']);
    const calls = stubNetwork();

    const result = await run(persistRequest(validBody), bucket);

    expect(summarize(calls)).toEqual([
      'create-upload',
      'PUT https://upload.test/screenshot.png',
      'finalize [screenshot.png]',
      'PUT https://upload.test/singlefile.html',
      'finalize [singlefile.html]'
    ]);
    expect(result).toEqual({
      status: 502,
      body: {
        error: 'Upload failed for some artifacts',
        firestore_doc_id: DOC_ID,
        uploaded: 2,
        artifacts: [
          { kind: 'screenshot.png', gcs_path: 'archives/req-1/screenshot/output.png' },
          { kind: 'singlefile.html', gcs_path: 'archives/req-1/singlefile/output.html.gz' }
        ],
        failed: [{ kind: 'page.pdf', error: expect.stringContaining('Artifact not found in R2') }]
      }
    });
  });
});

describe('storage path parity', () => {
  // Every kind the worker persists (manifest.json is filtered out before persist).
  const PERSISTED_KINDS: ArtifactKind[] = [
    'singlefile.html',
    'monolith.html',
    'readability.json',
    'readability.md',
    'page.pdf',
    'screenshot.png',
    'rendered.html',
    'rendered.md'
  ];

  const READABILITY_BODY = JSON.stringify({
    title: 't',
    byline: null,
    dir: null,
    lang: null,
    content: null, // no HTML, so the image scan (Workers-only HTMLRewriter) is skipped
    textContent: 'x',
    length: 1,
    excerpt: null,
    siteName: null,
    publishedTime: null
  });

  function singleKindBucket(kind: ArtifactKind): { m: ArchiveManifest; bucket: FakeBucket } {
    const m = manifest([kind]);
    const objects: Record<string, string | object> = { [MANIFEST_KEY]: m };
    objects[m.artifacts[0]!.r2Key] = kind === 'readability.json' ? READABILITY_BODY : `body of ${kind}`;
    return { m, bucket: makeBucket(objects) };
  }

  it.each(PERSISTED_KINDS)('%s: the worker and the upload function agree on the storage path', async (kind) => {
    const expected = getGcsPath(REQUEST_ID, kind);
    const { bucket } = singleKindBucket(kind);
    const calls = stubNetwork({
      // The upload function answers with the shared helper's path, as it does in production.
      createUpload: (body) =>
        Response.json({
          firestore_doc_id: DOC_ID,
          uploads: body.artifacts.map((a) => ({
            kind: a.kind,
            signed_url: `https://upload.test/${a.kind}`,
            gcs_path: getGcsPath(body.request_id, a.kind).path,
            expires_at: '2026-11-08T01:00:00Z'
          }))
        })
    });

    const result = await run(persistRequest(validBody), bucket);
    expect(result.status).toBe(200);

    const createUpload = calls.find((c) => c.url === `${FN_BASE}/create-upload`)!;
    const listed = (createUpload.json as { artifacts: Array<{ kind: ArtifactKind; filename: string }> }).artifacts;
    expect(listed).toEqual([expect.objectContaining({ kind, filename: expected.filename })]);

    const finalize = calls.find((c) => c.url === `${FN_BASE}/finalize`)!;
    const uploaded = (finalize.json as { uploaded: Array<{ kind: ArtifactKind; gcs_path: string }> }).uploaded;
    expect(uploaded).toEqual([expect.objectContaining({ kind, gcs_path: expected.path })]);

    vi.unstubAllGlobals();
    stubNetwork();
    const dryRun = await run(persistRequest({ ...validBody, dryRun: true }), singleKindBucket(kind).bucket);
    expect(dryRun.body).toEqual(
      expect.objectContaining({ artifacts: [{ kind, gcs_path: expected.path }], dryRun: true })
    );
  });
});
