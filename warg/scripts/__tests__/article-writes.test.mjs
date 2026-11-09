import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { isScannedSource } from '../check-article-writes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, '..', 'check-article-writes.mjs');
const FIXTURES = join(HERE, 'fixtures', 'article-writes');
const REPO = resolve(HERE, '..', '..', '..');

const repoPath = (abs) => relative(REPO, abs).replace(/\\/g, '/');

function run(...files) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, '--files', ...files], {
      encoding: 'utf8'
    });
    return { status: 0, stdout };
  } catch (err) {
    return { status: err.status, stdout: err.stdout };
  }
}

const findings = (stdout) => stdout.split(/\r?\n/).filter((l) => l.includes(' article-write '));

// Line numbers (1-based) of the fixture lines whose comment starts with `fixture:`.
function fixtureLines(file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  return lines.flatMap((text, i) => {
    const m = /\/\/ fixture: (.+)$/.exec(text);
    return m ? [{ line: i + 1, name: m[1] }] : [];
  });
}

test('a direct set on an articles document fails the check and names the file and line', () => {
  const file = join(FIXTURES, 'direct-writes.ts');
  const { status, stdout } = run(file);
  assert.equal(status, 1);
  const set = fixtureLines(file).find((f) => f.name === 'direct set');
  assert.ok(set, 'the fixture has a direct set line');
  assert.ok(
    findings(stdout).includes(`${repoPath(file)}:${set.line} article-write DocumentReference.set`),
    stdout
  );
});

test('each direct write of the fixture is one finding, and nothing else is', () => {
  const file = join(FIXTURES, 'direct-writes.ts');
  const { stdout } = run(file);
  const expected = fixtureLines(file).map((f) => `${repoPath(file)}:${f.line}`);
  assert.equal(expected.length, 6);
  assert.deepEqual(
    findings(stdout).map((l) => l.split(' ')[0]),
    expected
  );
});

test('collection methods and marked writes to other documents pass the check', () => {
  const { status, stdout } = run(join(FIXTURES, 'allowed-writes.ts'));
  assert.equal(status, 0, stdout);
  assert.deepEqual(findings(stdout), []);
});

test('a marker two lines above a write does not exempt it', () => {
  // Inside the warg tree, so the Firestore types resolve from warg/node_modules.
  const dir = mkdtempSync(join(FIXTURES, 'tmp-'));
  try {
    const file = join(dir, 'far-marker.ts');
    writeFileSync(
      file,
      [
        "import { getFirestore } from 'firebase-admin/firestore';",
        'export async function farMarker(id: string): Promise<void> {',
        '  // article-write-check: not-an-article (too far away)',
        "  const ref = getFirestore().collection('articles').doc(id);",
        "  await ref.set({ title: 'x' });",
        '}',
        ''
      ].join('\n')
    );
    const { status, stdout } = run(file);
    assert.equal(status, 1);
    assert.deepEqual(findings(stdout), [
      `${repoPath(file)}:5 article-write DocumentReference.set`
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('only non-test sources of a cloud function are scanned', () => {
  const pkg = 'warg/cloud-functions/example';
  assert.equal(isScannedSource(`${pkg}/src/a.ts`), true);
  assert.equal(isScannedSource(`${pkg}/src/nested/a.ts`), true);
  assert.equal(isScannedSource(`${pkg}/src/__tests__/a.ts`), false);
  assert.equal(isScannedSource(`${pkg}/src/a.test.ts`), false);
  assert.equal(isScannedSource(`${pkg}/src/a.int.test.ts`), false);
  assert.equal(isScannedSource('warg/packages/article-writer/src/a.ts'), false);
  assert.equal(isScannedSource('warg/workers/gateway/src/a.ts'), false);
});
