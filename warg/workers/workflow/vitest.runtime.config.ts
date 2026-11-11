import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { build } from 'esbuild';
import { defineConfig } from 'vitest/config';
import {
  ARTICLE_ABOUT_CHALLENGES,
  CLOUDFLARE_CHALLENGE_PAGE
} from '@warg/shared/fixtures';
import { accessBlockedResponse } from '../../packages/shared/src/render-content.ts';
import { COMPATIBILITY_DATE } from '../compatibility-date.mjs';

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
  'ai-markdown.md',
  'manifest.json'
];

// The target URLs of the blocked-page cases; end-state.runtime.test.ts uses the same values.
const CHALLENGE_URL = 'https://challenge.example/article';
const BLOCKED_URL = 'https://blocked.example/article';
const ARTICLE_URL = 'https://article.example/post';

// The target URL of the refused R2 handler case; end-state.runtime.test.ts uses the same value.
const R2_REFUSED_URL = 'https://r2-refused.example/article';

// The target URL of the render retry case; end-state.runtime.test.ts uses the same value.
const RETRY_URL = 'https://retry.example/article';

// The PNG signature, as the base64 text a snapshot screenshot arrives in.
const PNG_BASE64 = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));

const failingService = () => new Response('stubbed failure', { status: 500 });

/** The target URL of a request whose JSON body names it in `url`. */
async function requestedUrl(request: Request): Promise<string | undefined> {
  const body: unknown = await request.json();
  if (typeof body !== 'object' || body === null || !('url' in body)) return undefined;
  return typeof body.url === 'string' ? body.url : undefined;
}

/** The recorded page the browser binding loads for each target URL of the blocked-page and R2 handler cases. */
const LOADED_PAGES: Record<string, string> = {
  [CHALLENGE_URL]: CLOUDFLARE_CHALLENGE_PAGE,
  [ARTICLE_URL]: ARTICLE_ABOUT_CHALLENGES,
  [R2_REFUSED_URL]: ARTICLE_ABOUT_CHALLENGES,
  [RETRY_URL]: ARTICLE_ABOUT_CHALLENGES
};

/**
 * Stands in for the Browser Rendering binding that the real renderer calls:
 * `quickAction('content' | 'snapshot')` answers a recorded page for the
 * blocked-page, credential and retry cases, and every other action or URL
 * fails, as the old renderer stub did. A service binding to this worker's
 * entrypoint gives the renderer `env.BROWSER.quickAction()` over Workers RPC.
 *
 * Each call is recorded in R2 as `stand-in-calls/<encoded url>/<action>/<id>`
 * before it is answered, so a test can count the loads of a run. For
 * RETRY_URL the snapshot also carries a screenshot and Markdown, and the
 * first PDF load is rate limited (429) while every later one answers a PDF.
 */
const browserStandIn = `
import { WorkerEntrypoint } from 'cloudflare:workers';

const LOADED_PAGES = ${JSON.stringify(LOADED_PAGES)};
const RETRY_URL = ${JSON.stringify(RETRY_URL)};
const PNG_BASE64 = ${JSON.stringify(PNG_BASE64)};

const failure = () => new Response('stubbed failure', { status: 500 });

export class BrowserStandIn extends WorkerEntrypoint {
  async quickAction(action, options) {
    const url = options?.url;
    const calls = 'stand-in-calls/' + encodeURIComponent(String(url)) + '/' + action + '/';
    const earlier = await this.env.ARCHIVE_BUCKET.list({ prefix: calls });
    await this.env.ARCHIVE_BUCKET.put(calls + crypto.randomUUID(), '');
    const html = LOADED_PAGES[url];
    if (html === undefined) return failure();
    if (action === 'content') return Response.json({ success: true, result: html });
    if (action === 'snapshot') {
      if (url === RETRY_URL) {
        return Response.json({ success: true, result: { content: html, screenshot: PNG_BASE64, markdown: '# Retried article' } });
      }
      return Response.json({ success: true, result: { content: html } });
    }
    if (action === 'pdf' && url === RETRY_URL) {
      if (earlier.objects.length === 0) {
        return Response.json(
          { success: false, errors: [{ message: 'Rate limit exceeded', code: 429 }] },
          { status: 429, headers: { 'Retry-After': '1' } }
        );
      }
      return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), { headers: { 'Content-Type': 'application/pdf' } });
    }
    return failure();
  }
}

export default { fetch: failure };
`;

/** singlefile answers the block of a 403 navigation for BLOCKED_URL, and fails otherwise. */
async function singlefileStub(request: Request): Promise<Response> {
  const url = await requestedUrl(request);
  if (url === BLOCKED_URL) return accessBlockedResponse(url, 403);
  return failingService();
}

/** monolith answers a refused R2 handler request for R2_REFUSED_URL, and fails otherwise. */
async function monolithStub(request: Request): Promise<Response> {
  const body: unknown = await request.json();
  const baseUrl =
    typeof body === 'object' && body !== null && 'base_url' in body && typeof body.base_url === 'string'
      ? body.base_url
      : undefined;
  if (baseUrl === R2_REFUSED_URL) {
    // The answer of the monolith worker when its R2 handler refuses the container's request.
    return Response.json(
      {
        error: 'Internal error',
        message: 'R2 handler answered 403: curl: (22) The requested URL returned error: 403',
        code: 'MONOLITH_R2_HANDLER_FAILED',
        retryable: false
      },
      { status: 502 }
    );
  }
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
        // The Workers AI binding is remote-only; the suite stays offline. READABILITY
        // is a failing stub here, so the AI Markdown step never runs.
        remoteBindings: false,
        miniflare: {
          bindings: { INTERNAL_API_KEY, TEST_MIGRATIONS: migrations },
          d1Databases: { INDEX_DB: 'idx' },
          // One bucket for the workflow and the renderer.
          r2Buckets: { ARCHIVE_BUCKET: 'archive' },
          serviceBindings: {
            HYPERRENDERER: failingService,
            SINGLEFILE: singlefileStub,
            READABILITY: failingService,
            MONOLITH: monolithStub,
            GCS: persistingGcs
          },
          workers: [
            {
              name: 'logger',
              modules: true,
              script: logger.outputFiles[0].text,
              compatibilityDate: COMPATIBILITY_DATE,
              compatibilityFlags: ['nodejs_compat'],
              bindings: { INTERNAL_API_KEY },
              durableObjects: { LOGGER_DO: { className: 'LoggerDO', useSQLite: true } },
              d1Databases: { INDEX_DB: 'idx' }
            },
            {
              name: 'browser-stand-in',
              modules: true,
              script: browserStandIn,
              compatibilityDate: COMPATIBILITY_DATE,
              // The same bucket as the renderer, for the record of each call.
              r2Buckets: { ARCHIVE_BUCKET: 'archive' }
            },
            {
              name: 'renderer',
              modules: true,
              script: renderer.outputFiles[0].text,
              compatibilityDate: COMPATIBILITY_DATE,
              compatibilityFlags: ['nodejs_compat'],
              bindings: { INTERNAL_API_KEY },
              r2Buckets: { ARCHIVE_BUCKET: 'archive' },
              serviceBindings: { BROWSER: { name: 'browser-stand-in', entrypoint: 'BrowserStandIn' } }
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
