import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BASE64_BLOB,
  format,
  scan
} from '../check-keys-and-uid.mjs';

const SCRIPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'check-keys-and-uid.mjs'
);

// Samples are built at run time so no uid-shaped literal is committed.
const repeatTo = (chunk, n) => chunk.repeat(Math.ceil(n / chunk.length)).slice(0, n);
const SAMPLE = repeatTo('Ab3', 28); // upper, lower, digit
const NO_DIGIT = repeatTo('Abc', 28);
const FN = 'warg/cloud-functions/example/src/index.ts';

const rules = (hits) => hits.map((h) => h.rule);

test('key-param flags a defineString key and passes defineSecret and a non-key parameter', () => {
  const text = [
    "const A = defineString('PUBLIC_API_KEY');",
    "const B = defineSecret('INTERNAL_API_KEY');",
    "const C = defineString('GATEWAY_URL');",
    "const D = defineInt( 'SIGNING_TOKEN' );"
  ].join('\n');
  const hits = scan([{ path: FN, text }]);
  assert.deepEqual(
    hits.map((h) => [h.line, h.rule, h.detail]),
    [
      [1, 'key-param', 'PUBLIC_API_KEY'],
      [4, 'key-param', 'SIGNING_TOKEN']
    ]
  );
});

test('key-param applies only to cloud-function sources', () => {
  const text = "const A = defineString('PUBLIC_API_KEY');";
  assert.deepEqual(scan([{ path: 'warg/workers/gateway/src/index.ts', text }]), []);
});

test('module-key-read flags a top-level env read of a key and passes a read inside a function', () => {
  const text = [
    "const KEY = process.env['INTERNAL_API_KEY'] ?? '';",
    'export const SECRET = process.env.CF_ACCESS_CLIENT_SECRET;',
    "const URL = process.env['GATEWAY_URL'] ?? 'https://example.invalid';",
    'export function send() {',
    "  const key = process.env['INTERNAL_API_KEY'] ?? '';",
    '  return key;',
    '}'
  ].join('\n');
  const hits = scan([{ path: FN, text }]);
  assert.deepEqual(
    hits.map((h) => [h.line, h.rule, h.detail]),
    [
      [1, 'module-key-read', 'INTERNAL_API_KEY'],
      [2, 'module-key-read', 'CF_ACCESS_CLIENT_SECRET']
    ]
  );
});

test('uid-shape flags a mixed-case token with a digit in any tracked text file', () => {
  const hits = scan([
    { path: 'warg/scripts/a.mjs', text: `const id = '${SAMPLE}';` },
    { path: 'docs/notes.md', text: `see users/${SAMPLE}/articles/x` }
  ]);
  assert.deepEqual(rules(hits), ['uid-shape', 'uid-shape']);
});

test('uid-shape passes a token with no digit, a longer token and a lockfile', () => {
  const hits = scan([
    { path: 'a.ts', text: `'${NO_DIGIT}'` },
    { path: 'b.ts', text: `'${SAMPLE}x'` },
    { path: 'warg/pnpm-lock.yaml', text: `integrity: ${SAMPLE}` },
    { path: 'android/gradle.lock', text: SAMPLE }
  ]);
  assert.deepEqual(hits, []);
});

test('uid-shape honours the per-line allow marker', () => {
  const hits = scan([
    { path: 'a.ts', text: `const id = '${SAMPLE}'; // uid-check: allow\nconst b = '${SAMPLE}';` }
  ]);
  assert.deepEqual(
    hits.map((h) => h.line),
    [2]
  );
});

test('uid-shape passes a token inside a long base64 run and flags one in a short path', () => {
  const blob = `${repeatTo('QUJD+/', BASE64_BLOB)}+${SAMPLE}/${repeatTo('xyz', 10)}`;
  assert.deepEqual(scan([{ path: 'res/cert.xml', text: blob }]), []);
  const path = `users/${SAMPLE}/articles/${repeatTo('k', 20)}`;
  assert.deepEqual(rules(scan([{ path: 'a.md', text: path }])), ['uid-shape']);
});

test('a finding never carries the token', () => {
  const [hit] = scan([{ path: 'a.ts', text: `'${SAMPLE}'` }]);
  assert.ok(!format(hit).includes(SAMPLE));
  assert.match(format(hit), /^a\.ts:1 uid-shape <28 alphanumeric>$/);
});

test('the CLI exits 1 on a hit without printing the token, and 0 on a clean tree', () => {
  const repo = mkdtempSync(join(tmpdir(), 'keys-and-uid-'));
  try {
    const git = (...args) =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
    git('init', '-q');
    mkdirSync(join(repo, 'src'));
    writeFileSync(join(repo, 'src', 'clean.ts'), "export const x = 'ok';\n");
    git('add', '.');
    const clean = execFileSync(process.execPath, [SCRIPT], {
      cwd: repo,
      encoding: 'utf8'
    });
    assert.match(clean, /^ok /);

    writeFileSync(join(repo, 'src', 'leak.ts'), `export const id = '${SAMPLE}';\n`);
    git('add', '.');
    let out = '';
    let status = 0;
    try {
      execFileSync(process.execPath, [SCRIPT], { cwd: repo, encoding: 'utf8' });
    } catch (err) {
      status = err.status;
      out = `${err.stdout}${err.stderr}`;
    }
    assert.equal(status, 1);
    assert.match(out, /src\/leak\.ts:1 uid-shape/);
    assert.ok(!out.includes(SAMPLE));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
