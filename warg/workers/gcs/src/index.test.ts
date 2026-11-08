import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveManifest, ArtifactKind } from '@warg/shared';
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
