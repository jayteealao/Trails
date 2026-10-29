// Each Cloud Function bundles alone, so a few helpers are copied between them:
// the shared-article id shapes, the canonical link resolution, the key compare
// and the key-rotation switch. These tests fail when one copy changes and the
// others do not, so a rule change reaches every function together.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('the readers share one shared-id shape and the creators share another', () => {
  const reader = ['dashboard-api/src/util.ts', 'backfill-archiver/src/canonical.ts'].map((rel) =>
    regexLiteral(source(rel), 'SHARED_ID_SHAPE', rel),
  );
  assert.equal(reader[0], reader[1]);

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

test('the canonical link resolution is the same in the dashboard and the backfill', () => {
  assertSameBodies([
    ['dashboard-api/src/util.ts', 'resolveCanonicalItemId'],
    ['backfill-archiver/src/canonical.ts', 'resolveCanonicalFromUserDoc'],
  ]);
  for (const rel of ['dashboard-api/src/util.ts', 'backfill-archiver/src/canonical.ts', 'user-triggers/src/link.ts']) {
    assert.match(source(rel), /'mergedInto'/, `${rel} no longer reads mergedInto`);
  }
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
