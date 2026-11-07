import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { build } from 'esbuild';
import { defineConfig } from 'vitest/config';

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

const failingService = () => new Response('stubbed failure', { status: 500 });

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

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: { INTERNAL_API_KEY, TEST_MIGRATIONS: migrations },
          d1Databases: { INDEX_DB: 'idx' },
          serviceBindings: {
            RENDERER: failingService,
            HYPERRENDERER: failingService,
            SINGLEFILE: failingService,
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
