import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  GRACE_PLACEHOLDER,
  normalizeLf,
  readGraceEnd,
  rulesetContent,
  sha256Hex,
  stampGraceEnd,
  storageBuckets
} from '../rules-release.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FIREBASE = resolve(REPO, 'firebase');
const END = 1893456000000;
const SOURCE = `rules_version = '2';\nfunction graceEnd() {\n  return ${GRACE_PLACEHOLDER}\n}\n`;

test('stampGraceEnd replaces the placeholder with the end', () => {
  const out = stampGraceEnd(SOURCE, END);
  assert.equal(out.includes(GRACE_PLACEHOLDER), false);
  assert.equal(out.match(/__GRACE_END_MS__/g).length, 1);
  assert.match(out, /timestamp\.value\(1893456000000\); \/\/ __GRACE_END_MS__/);
});

test('stampGraceEnd refuses zero or two placeholders', () => {
  assert.throws(() => stampGraceEnd('no placeholder here', END), /exactly once/);
  assert.throws(() => stampGraceEnd(SOURCE + SOURCE, END), /exactly once/);
});

test('stampGraceEnd refuses an end that is not a positive whole number', () => {
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => stampGraceEnd(SOURCE, bad), /positive whole number/);
  }
});

test('readGraceEnd returns the stamped end and null otherwise', () => {
  assert.equal(readGraceEnd(stampGraceEnd(SOURCE, END)), END);
  assert.equal(readGraceEnd(SOURCE), null);
  assert.equal(readGraceEnd('rules_version = "2";'), null);
  const twice = stampGraceEnd(SOURCE, END) + stampGraceEnd(SOURCE, END);
  assert.equal(readGraceEnd(twice), null);
});

test('a CRLF source stamps to LF output', () => {
  const crlf = SOURCE.replace(/\n/g, '\r\n');
  const out = stampGraceEnd(normalizeLf(crlf), END);
  assert.equal(out.includes('\r'), false);
  assert.equal(out, stampGraceEnd(SOURCE, END));
});

test('sha256Hex tells CRLF from LF and matches normalized forms', () => {
  const crlf = SOURCE.replace(/\n/g, '\r\n');
  assert.notEqual(sha256Hex(crlf), sha256Hex(SOURCE));
  assert.equal(sha256Hex(normalizeLf(crlf)), sha256Hex(normalizeLf(SOURCE)));
  assert.match(sha256Hex(SOURCE), /^[0-9a-f]{64}$/);
});

test('storageBuckets resolves the real firebase.json and .firebaserc', () => {
  const config = JSON.parse(readFileSync(resolve(FIREBASE, 'firebase.json'), 'utf8'));
  const rc = JSON.parse(readFileSync(resolve(FIREBASE, '.firebaserc'), 'utf8'));
  assert.deepEqual(storageBuckets(config, rc, 'trails-e428e'), [
    'trails-e428e.firebasestorage.app',
    'htbase-archives-standard'
  ]);
});

test('storageBuckets throws for a target with no bucket', () => {
  const config = { storage: [{ rules: 'storage.rules', target: 'unknown' }] };
  assert.throws(() => storageBuckets(config, { targets: {} }, 'trails-e428e'), /unknown/);
});

test('rulesetContent takes the single file of a ruleset', () => {
  const body = { name: 'projects/p/rulesets/r', source: { files: [{ name: 'firestore.rules', content: 'x' }] } };
  assert.equal(rulesetContent(body), 'x');
  assert.throws(() => rulesetContent({ source: { files: [] } }), /exactly one/);
  assert.throws(() => rulesetContent({}), /exactly one/);
});

test('the committed Firestore rules hold the placeholder exactly once', () => {
  const source = normalizeLf(readFileSync(resolve(FIREBASE, 'firestore.rules'), 'utf8'));
  assert.equal(source.split(GRACE_PLACEHOLDER).length - 1, 1);
  assert.equal(readGraceEnd(source), null);
  assert.equal(readGraceEnd(stampGraceEnd(source, END)), END);
});
