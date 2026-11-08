// Each Cloud Function bundles alone, so a few helpers are copied between them:
// the creator shared-article id shape, the key compare and the key-rotation
// switch. These tests fail when one copy changes and the others do not, so a
// rule change reaches every function together. The link reader and the pocket
// projection are not copied: they live once in @warg/article-writer, and these
// tests fail when a function defines its own.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const functionsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../cloud-functions');

/**
 * The file as TypeScript emits it: types and comments removed and the layout
 * reprinted, so a comment, a type annotation or a formatting change in one copy
 * does not count as a difference.
 */
function source(rel) {
  const text = readFileSync(resolve(functionsDir, rel), 'utf8');
  return ts.transpileModule(text, {
    compilerOptions: { removeComments: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
}

/** The body of `function <name>(...) {...}` in `text`, whitespace collapsed. */
function functionText(text, name, rel) {
  const start = text.search(new RegExp(`(?:export )?function ${name}\\(`));
  assert.notEqual(start, -1, `${rel} has no function ${name}`);
  const open = text.indexOf('{', text.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1).replace(/\s+/g, ' ');
    }
  }
  assert.fail(`${rel}: function ${name} is not closed`);
}

/** The regex literal assigned to `const <name> =` in `text`. */
function regexLiteral(text, name, rel) {
  const match = text.match(new RegExp(`const ${name} = (/.+/[a-z]*);`));
  assert.ok(match, `${rel} has no regex constant ${name}`);
  return match[1];
}

function assertSameFunction(name, rels) {
  assertSameBodies(rels.map((rel) => [rel, name]));
}

/** Every [file, function] pair has the same body. */
function assertSameBodies(pairs) {
  const [first, ...rest] = pairs.map(([rel, name]) => ({ rel: `${rel} ${name}`, text: functionText(source(rel), name, rel) }));
  for (const other of rest) {
    assert.equal(other.text, first.text, `${first.rel} and ${other.rel} differ`);
  }
}

test('the reader shared-id shape accepts every id a creator makes, and the creators share one shape', () => {
  const resolveRel = '../packages/article-writer/src/resolve.ts';
  const reader = [regexLiteral(source(resolveRel), 'SHARED_ID_SHAPE', resolveRel)];

  const creator = [
    ['user-triggers/src/link.ts', 'SHARED_ID_PATTERN'],
    ['dashboard-api/src/signed-url-core.ts', 'SAFE_ID_RE'],
    ['dashboard-api/src/bootstrap-article.ts', 'SAFE_ID_RE'],
    ['dashboard-api/src/enqueue-article.ts', 'SAFE_ID_RE'],
    ['dashboard-api/src/mark-processing.ts', 'SAFE_ID_RE'],
  ].map(([rel, name]) => regexLiteral(source(rel), name, rel));
  for (const literal of creator) assert.equal(literal, creator[0]);

  // A reader must accept every id a creator makes: same characters, and a
  // lower minimum length (legacy ids are shorter than new ones).
  const readerRe = new RegExp(reader[0].slice(1, -1));
  for (const id of ['abcdefgh', 'aZ09_-bc', 'a'.repeat(40)]) {
    assert.ok(new RegExp(creator[0].slice(1, -1)).test(id), id);
    assert.ok(readerRe.test(id), id);
  }
  assert.equal(readerRe.test('a'.repeat(41)), false);
  assert.equal(readerRe.test('abc/defg'), false);
});

// The link reader and the pocket projection are defined once, in
// @warg/article-writer. These files still hold an older copy; each one leaves
// the list when its callers move to the module, and a file that adds a copy
// fails the test.
const KNOWN_COPIES = [
  'backfill-archiver/src/canonical.ts',
  'dashboard-api/src/bootstrap-article.ts',
  'dashboard-api/src/util.ts',
  'user-triggers/src/handler.ts',
  'user-triggers/src/link.ts',
];

const COPY_DECLARATION =
  /\bconst SHARED_ID_SHAPE\b|\bfunction (?:resolveCanonical(?!Candidates)\w*|readCanonicalId|mergedTarget\w*|followMergedIntoOnce|readSharedArticle\w*|buildPocket|pocketFromSave|asPocketTime|projectPocket)\s*[(<]/;
const SURVIVORS = ['resolveCanonicalItemId', 'readCanonicalId', 'mergedTargetOf', 'readSharedArticle', 'readSharedArticles', 'projectPocket'];

/** Every non-test TypeScript source of the cloud functions, as `<function>/src/<path>`. */
function functionSources() {
  const out = [];
  for (const fn of readdirSync(functionsDir)) {
    const src = resolve(functionsDir, fn, 'src');
    if (!existsSync(src)) continue;
    for (const rel of readdirSync(src, { recursive: true })) {
      const path = `${fn}/src/${String(rel).replaceAll('\\', '/')}`;
      if (!path.endsWith('.ts') || path.endsWith('.test.ts') || path.includes('/__tests__/')) continue;
      out.push(path);
    }
  }
  return out.sort();
}

/** The names a file imports from `from`, by its import declarations. */
function importedNames(text, from) {
  const names = new Set();
  for (const match of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    if (!from(match[2])) continue;
    for (const part of match[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0];
      if (name) names.add(name);
    }
  }
  return names;
}

test('no cloud function defines its own link reader or pocket projection beyond the known copies', () => {
  const copies = functionSources().filter((rel) => COPY_DECLARATION.test(readFileSync(resolve(functionsDir, rel), 'utf8')));
  assert.deepEqual(copies, KNOWN_COPIES);
});

test('every caller of the link reader or the pocket projection imports it from the article module', () => {
  for (const rel of functionSources()) {
    if (KNOWN_COPIES.includes(rel)) continue;
    const text = readFileSync(resolve(functionsDir, rel), 'utf8');
    const fromModule = importedNames(text, (spec) => spec === '@warg/article-writer');
    // A caller of a copy that has not moved yet imports it from that copy.
    const fromCopy = importedNames(text, (spec) =>
      KNOWN_COPIES.includes(`${rel.split('/')[0]}/src/${spec.replace(/^\.\//, '').replace(/\.js$/, '.ts')}`),
    );
    for (const name of SURVIVORS) {
      if (!new RegExp(`\\b${name}\\s*\\(`).test(text)) continue;
      assert.ok(fromModule.has(name) || fromCopy.has(name), `${rel} calls ${name} without importing it from @warg/article-writer`);
    }
  }
});

test('the article module exports the link reader and the pocket projection', () => {
  const index = readFileSync(resolve(functionsDir, '../packages/article-writer/src/index.ts'), 'utf8');
  assert.match(index, /export \* from '\.\/resolve\.js';/);
  assert.match(index, /export \* from '\.\/pocket\.js';/);
});

test('the key compare and the rotation helpers are the same in every function', () => {
  assertSameFunction('safeEqual', ['archive-gateway/src/auth.ts', 'dashboard-api/src/auth.ts']);
  assertSameFunction('dualAcceptOn', [
    'archive-gateway/src/secrets.ts',
    'backfill-archiver/src/secrets.ts',
    'dashboard-api/src/secrets.ts',
  ]);
  assertSameFunction('requireSecret', [
    'archive-gateway/src/secrets.ts',
    'backfill-archiver/src/secrets.ts',
    'user-triggers/src/secrets.ts',
  ]);
  assertSameFunction('gatewayBeginConfig', ['backfill-archiver/src/secrets.ts', 'user-triggers/src/secrets.ts']);
});
