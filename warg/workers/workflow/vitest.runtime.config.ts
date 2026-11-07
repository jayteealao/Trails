import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { build } from 'esbuild';
import { defineConfig } from 'vitest/config';
import {
  ARTICLE_ABOUT_CHALLENGES,
  CLOUDFLARE_CHALLENGE_PAGE
} from '../../packages/shared/src/challenge-page.fixtures.ts';
import { accessBlockedResponse } from '../../packages/shared/src/render-content.ts';

const INTERNAL_API_KEY = 'runtime-test-key-local-only';

// Every kind the workflow can persist, so a test never reaches the
// "unpersisted artifacts" failure because of the stub.
const ARTIFACT_KINDS = [
  'rendered.html',
  'rendered.md',
  'screenshot.png',
  'page.pdf',
  'singlefile.html',
  'readability.json',
  'readability.md',
  'monolith.html',
  'manifest.json'
];

// The target URLs of the blocked-page cases; end-state.runtime.test.ts uses the same values.
const CHALLENGE_URL = 'https://challenge.example/article';
const BLOCKED_URL = 'https://blocked.example/article';
const ARTICLE_URL = 'https://article.example/post';

const failingService = () => new Response('stubbed failure', { status: 500 });

/** The target URL of a request whose JSON body names it in `url`. */
async function requestedUrl(request: Request): Promise<string | undefined> {
  const body: unknown = await request.json();
  if (typeof body !== 'object' || body === null || !('url' in body)) return undefined;
  return typeof body.url === 'string' ? body.url : undefined;
}

/**
 * Stands in for the Browser Rendering REST API that the real renderer calls:
 * `/content` answers a recorded page for the blocked-page cases, and every
 * other call fails, as the old renderer stub did.
 */
async function browserRenderingStandIn(request: Request): Promise<Response> {
  if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/browser-rendering/content')) {
    return failingService();
  }
  const url = await requestedUrl(request);
  if (url === CHALLENGE_URL) return Response.json({ success: true, result: CLOUDFLARE_CHALLENGE_PAGE });
  if (url === ARTICLE_URL) return Response.json({ success: true, result: ARTICLE_ABOUT_CHALLENGES });
  return failingService();
}

/** singlefile answers the block of a 403 navigation for BLOCKED_URL, and fails otherwise. */
async function singlefileStub(request: Request): Promise<Response> {
  const url = await requestedUrl(request);
  if (url === BLOCKED_URL) return accessBlockedResponse(url, 403);
  return failingService();
}

const persistingGcs = () =>
  Response.json({
    success: true,
    firestore_doc_id: 'test-doc',
    uploaded: ARTIFACT_KINDS.length,
    artifacts: ARTIFACT_KINDS.map((kind) => ({ kind, gcs_path: `gs://test/${kind}` }))
  });

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, '../logger/migrations'));

  // The real logger runs beside the workflow, so a test reads the stage from
  // the real status route. The script stays inline: workerd stopped at start
  // when it was given an absolute Windows path.
  const logger = await build({
    entryPoints: [path.join(__dirname, '../logger/src/index.ts')],
    bundle: true,
    format: 'esm',
    target: 'esnext',
    external: ['cloudflare:*'],
    write: false
  });

  // The real renderer runs too, so a test sees what it stores and what it reports.
  const renderer = await build({
    entryPoints: [path.join(__dirname, '../renderer/src/index.ts')],
    bundle: true,
    format: 'esm',
    target: 'esnext',
    external: ['cloudflare:*'],
    write: false
  });

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: { INTERNAL_API_KEY, TEST_MIGRATIONS: migrations },
          d1Databases: { INDEX_DB: 'idx' },
          // One bucket for the workflow and the renderer.
          r2Buckets: { ARCHIVE_BUCKET: 'archive' },
          serviceBindings: {
            HYPERRENDERER: failingService,
            SINGLEFILE: singlefileStub,
            READABILITY: failingService,
            MONOLITH: failingService,
            GCS: persistingGcs
          },
          workers: [
            {
              name: 'logger',
              modules: true,
              script: logger.outputFiles[0].text,
              compatibilityDate: '2025-01-01',
              compatibilityFlags: ['nodejs_compat'],
              bindings: { INTERNAL_API_KEY },
              durableObjects: { LOGGER_DO: { className: 'LoggerDO', useSQLite: true } },
              d1Databases: { INDEX_DB: 'idx' }
            },
            {
              name: 'renderer',
              modules: true,
              script: renderer.outputFiles[0].text,
              compatibilityDate: '2025-01-01',
              compatibilityFlags: ['nodejs_compat'],
              bindings: { INTERNAL_API_KEY, CF_ACCOUNT_ID: 'test-account', BR_API_TOKEN: 'test-token-local-only' },
              r2Buckets: { ARCHIVE_BUCKET: 'archive' },
              outboundService: browserRenderingStandIn
            }
          ]
        }
      })
    ],
    test: {
      include: ['src/**/*.runtime.test.ts'],
      // A run that retries its failing services takes several seconds.
      testTimeout: 30_000
    }
  };
});
