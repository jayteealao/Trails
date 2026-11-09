// The article id rules, the URL domain helpers and the storage path of each
// artifact live once, in packages/shared/src/archive-ids.ts. The workers import
// them from '@warg/shared'; the cloud functions and the dashboard functions
// import the built '@warg/shared/archive-ids'. These tests fail when any worker,
// cloud function, dashboard function or package declares its own copy, or when
// a consumer stops importing the shared names.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const wargDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SHARED_FILE = 'packages/shared/src/archive-ids.ts';
// The link reader keeps its own reader shape; function-copies.test.mjs pins it
// equal to the shared reader rule.
const READER_SHAPE_FILE = 'packages/article-writer/src/resolve.ts';

const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'dist-deploy', '.wrangler', '.cloudflare', '__tests__']);
const COPY_FUNCTION = /\bfunction\s+(extractDomain|extractHostname|getGcsPath)\s*[(<]/g;
const COPY_BINDING =
  /\b(?:const|let|var)\s+(extractDomain|extractHostname|getGcsPath|SAFE_ID_RE|LEGACY_SAFE_ID_RE|SHARED_ID_PATTERN|ARTIFACT_PATH_MAP|GCS_PATH_CONFIG|GCS_ARTIFACT_PATHS)\b/g;
const CREATOR_LITERAL = '/^[a-zA-Z0-9_-]{8,40}$/';
const READER_LITERAL = '/^[a-zA-Z0-9_-]{1,40}$/';

/** The text as TypeScript emits it: types and comments removed. */
function transpile(text) {
  return ts.transpileModule(text, {
    compilerOptions: { removeComments: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
}

function source(rel) {
  return transpile(readFileSync(resolve(wargDir, rel), 'utf8'));
}

/** Every copy of a shared helper that `text` declares, as short labels. */
function findCopies(text, rel = '') {
  const found = [];
  for (const m of text.matchAll(COPY_FUNCTION)) found.push(`function ${m[1]}`);
  for (const m of text.matchAll(COPY_BINDING)) found.push(`const ${m[1]}`);
  if (text.includes(CREATOR_LITERAL)) found.push(`literal ${CREATOR_LITERAL}`);
  if (text.includes(READER_LITERAL)) {
    const allowed = rel === READER_SHAPE_FILE && text.includes(`const SHARED_ID_SHAPE = ${READER_LITERAL};`);
    if (!allowed || text.split(READER_LITERAL).length > 2) found.push(`literal ${READER_LITERAL}`);
  }
  return found;
}

/** The names `text` imports from the module `from`. */
function importedNames(text, from) {
  const names = [];
  const escaped = from.replace(/[/.]/g, '\\$&');
  const re = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*['"]${escaped}['"]`, 'g');
  for (const match of text.matchAll(re)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0];
      if (name) names.push(name);
    }
  }
  return names;
}

/** Every non-test source file under the scanned folders, relative to warg/. */
function scannedSources() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) walk(path);
        continue;
      }
      const name = entry.name;
      if (!/\.(?:ts|js|mjs)$/.test(name) || name.endsWith('.d.ts') || /\.test\.(?:ts|js|mjs)$/.test(name)) continue;
      files.push(relative(wargDir, path).replaceAll('\\', '/'));
    }
  };
  for (const group of ['workers', 'cloud-functions', 'packages']) {
    for (const entry of readdirSync(resolve(wargDir, group), { withFileTypes: true })) {
      const src = resolve(wargDir, group, entry.name, 'src');
      if (entry.isDirectory() && existsSync(src)) walk(src);
    }
  }
  walk(resolve(wargDir, 'pages/dashboard/functions'));
  return files.sort();
}

const WORKER = '@warg/shared';
const BUILT = '@warg/shared/archive-ids';
const CONSUMERS = [
  { rel: 'workers/gcs/src/artifacts.ts', from: WORKER, names: ['getGcsPath'] },
  { rel: 'workers/gcs/src/index.ts', from: WORKER, names: ['getGcsPath'] },
  { rel: 'workers/gateway/src/util.ts', from: WORKER, names: ['LEGACY_SAFE_ID_RE'] },
  { rel: 'workers/logger/src/LoggerDO.ts', from: WORKER, names: ['extractHostname'] },
  { rel: 'cloud-functions/archive-gateway/src/create-upload.ts', from: BUILT, names: ['getGcsPath', 'extractHostname'] },
  { rel: 'cloud-functions/backfill-archiver/src/canonical-candidates.ts', from: BUILT, names: ['extractDomain'] },
  { rel: 'cloud-functions/backfill-archiver/src/tracker.ts', from: BUILT, names: ['extractDomain'] },
  { rel: 'cloud-functions/dashboard-api/src/bootstrap-article.ts', from: BUILT, names: ['SAFE_ID_RE', 'extractDomain'] },
  { rel: 'cloud-functions/dashboard-api/src/enqueue-article.ts', from: BUILT, names: ['SAFE_ID_RE'] },
  { rel: 'cloud-functions/dashboard-api/src/list-articles.ts', from: BUILT, names: ['extractDomain'] },
  { rel: 'cloud-functions/dashboard-api/src/mark-processing.ts', from: BUILT, names: ['SAFE_ID_RE', 'extractDomain'] },
  { rel: 'cloud-functions/dashboard-api/src/signed-url-core.ts', from: BUILT, names: ['SAFE_ID_RE'] },
  { rel: 'cloud-functions/user-triggers/src/link.ts', from: BUILT, names: ['SAFE_ID_RE', 'extractDomain'] },
  { rel: 'pages/dashboard/functions/api/archive-content.ts', from: BUILT, names: ['SAFE_ID_RE'] },
  { rel: 'pages/dashboard/functions/api/begin.ts', from: BUILT, names: ['SAFE_ID_RE'] },
  { rel: 'pages/dashboard/functions/api/articles/[itemId]/retry-full.ts', from: BUILT, names: ['SAFE_ID_RE'] },
  { rel: 'pages/dashboard/functions/api/articles/[itemId]/retry-missing.ts', from: BUILT, names: ['SAFE_ID_RE'] },
  { rel: 'pages/dashboard/functions/api/articles/[itemId]/retry-step.ts', from: BUILT, names: ['SAFE_ID_RE'] },
];

test('the shared file declares every helper once', () => {
  assert.deepEqual(findCopies(source(SHARED_FILE)).sort(), [
    'const GCS_ARTIFACT_PATHS',
    'const LEGACY_SAFE_ID_RE',
    'const SAFE_ID_RE',
    'function extractDomain',
    'function extractHostname',
    'function getGcsPath',
    `literal ${READER_LITERAL}`,
    `literal ${CREATOR_LITERAL}`,
  ]);
});

test('no worker, cloud function, dashboard function or package declares its own copy', () => {
  const files = scannedSources();
  assert.ok(files.includes('cloud-functions/backfill-archiver/src/tracker.ts'), 'the scan reaches the cloud functions');
  assert.ok(files.includes('pages/dashboard/functions/api/begin.ts'), 'the scan reaches the dashboard functions');
  const offenders = files
    .filter((rel) => rel !== SHARED_FILE)
    .flatMap((rel) => findCopies(source(rel), rel).map((copy) => `${rel}: ${copy}`));
  assert.deepEqual(offenders, []);
});

for (const { rel, from, names } of CONSUMERS) {
  test(`${rel} imports ${names.join(', ')} from ${from}`, () => {
    const imported = importedNames(source(rel), from);
    for (const name of names) assert.ok(imported.includes(name), `${rel} does not import ${name} from ${from}`);
  });
}

test('the storage worker and the upload function take the storage path from the one shared function', () => {
  assert.ok(importedNames(source('workers/gcs/src/index.ts'), WORKER).includes('getGcsPath'));
  assert.ok(importedNames(source('cloud-functions/archive-gateway/src/create-upload.ts'), BUILT).includes('getGcsPath'));
});

test('the detector flags a planted copy', () => {
  const planted = transpile(`
    function extractDomain(url: string): string { return new URL(url).hostname; }
    const SAFE_ID_RE = /^[a-zA-Z0-9_-]{8,40}$/;
    const LEGACY = /^[a-zA-Z0-9_-]{1,40}$/;
  `);
  assert.deepEqual(findCopies(planted, 'workers/x/src/y.ts').sort(), [
    'const SAFE_ID_RE',
    'function extractDomain',
    `literal ${READER_LITERAL}`,
    `literal ${CREATOR_LITERAL}`,
  ]);
  assert.deepEqual(findCopies(transpile('const extractHostname = (u: string) => u;')), ['const extractHostname']);
  assert.deepEqual(findCopies(transpile('export const SHARED_ID_SHAPE = /^[a-zA-Z0-9_-]{1,40}$/;'), READER_SHAPE_FILE), []);
});
