import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  checkSandboxVersion,
  compareVersions,
  imageVersion,
  sdkVersion
} from '../check-sandbox-version.mjs';

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(SCRIPTS, 'check-sandbox-version.mjs');
const REAL_WORKER = join(SCRIPTS, '..', 'workers', 'monolith');

const dockerfile = (tag) => `FROM docker.io/cloudflare/sandbox:${tag}\n\nRUN true\n`;
const manifest = (sdk) =>
  JSON.stringify({ dependencies: sdk === undefined ? {} : { '@cloudflare/sandbox': sdk } });

// Runs the CLI against a worker folder holding the given files, and returns
// its exit code and output.
function run(dockerText, packageText) {
  const root = mkdtempSync(join(tmpdir(), 'sandbox-version-'));
  try {
    const dir = join(root, 'worker');
    mkdirSync(dir);
    writeFileSync(join(dir, 'Dockerfile'), dockerText);
    writeFileSync(join(dir, 'package.json'), packageText);
    const r = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('equal versions exit 0 and print both', () => {
  const r = run(dockerfile('0.12.14'), manifest('0.12.14'));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^ok {3}sandbox image 0\.12\.14, SDK 0\.12\.14$/m);
});

test('different versions exit 1 and name both', () => {
  const r = run(dockerfile('0.12.14'), manifest('0.12.3'));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^FAIL /m);
  assert.match(r.out, /0\.12\.14/);
  assert.match(r.out, /0\.12\.3/);
});

for (const range of ['^0.12.14', '~0.12.14']) {
  test(`SDK range ${range} exits 1 and names both`, () => {
    const r = run(dockerfile('0.12.14'), manifest(range));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /image 0\.12\.14/);
    assert.ok(r.out.includes(`SDK ${range}`), r.out);
  });
}

test('a variant image tag exits 1 and names both', () => {
  const r = run(dockerfile('0.12.14-python'), manifest('0.12.14'));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /image 0\.12\.14-python/);
  assert.match(r.out, /SDK 0\.12\.14/);
});

test('a digest on the image line exits 0 and compares the tag', () => {
  const r = run(dockerfile('0.12.14@sha256:' + 'a'.repeat(64)), manifest('0.12.14'));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^ok {3}sandbox image 0\.12\.14, SDK 0\.12\.14$/m);
});

test('a digest on a different tag exits 1 and names both', () => {
  const r = run(dockerfile('0.12.3@sha256:' + 'a'.repeat(64)), manifest('0.12.14'));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /image 0\.12\.3, SDK 0\.12\.14/);
});

test('a malformed digest exits 1 and never passes', () => {
  const r = run(dockerfile('0.12.14@sha256:abc'), manifest('0.12.14'));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /image \(none\)/);
});

test('a Dockerfile with no sandbox FROM line exits 1', () => {
  const r = run('FROM docker.io/library/ubuntu:22.04\n', manifest('0.12.14'));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /image \(none\)/);
  assert.match(r.out, /SDK 0\.12\.14/);
});

test('a sandbox FROM line with no tag exits 1', () => {
  const r = run('FROM docker.io/cloudflare/sandbox\n', manifest('0.12.14'));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /image \(none\)/);
});

test('a package.json with no SDK exits 1', () => {
  const r = run(dockerfile('0.12.14'), manifest(undefined));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /image 0\.12\.14/);
  assert.match(r.out, /SDK \(none\)/);
});

test('a CRLF Dockerfile exits 0', () => {
  const r = run(dockerfile('0.12.14').replaceAll('\n', '\r\n'), manifest('0.12.14'));
  assert.equal(r.code, 0, r.out);
});

test('a missing worker folder exits 1 and never passes', () => {
  const r = spawnSync(process.execPath, [SCRIPT, join(tmpdir(), 'no-such-sandbox-worker')], {
    encoding: 'utf8'
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^FAIL /m);
});

test('a package.json that is not JSON exits 1 and never passes', () => {
  const r = run(dockerfile('0.12.14'), '{ not json');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /^FAIL /m);
});

test('imageVersion tolerates --platform, an AS name and no registry', () => {
  assert.equal(imageVersion('FROM --platform=linux/amd64 docker.io/cloudflare/sandbox:1.2.3\n'), '1.2.3');
  assert.equal(imageVersion('FROM cloudflare/sandbox:1.2.3 AS base\n'), '1.2.3');
  assert.equal(imageVersion('from cloudflare/sandbox:1.2.3\n'), '1.2.3');
});

test('imageVersion ignores a comment and another image', () => {
  assert.equal(imageVersion('# FROM cloudflare/sandbox:9.9.9\nFROM cloudflare/sandbox:1.2.3\n'), '1.2.3');
  assert.equal(imageVersion('FROM example.com/cloudflare/sandbox-fork:1.2.3\n'), undefined);
});

test('sdkVersion reads the dependency and returns undefined without it', () => {
  assert.equal(sdkVersion(JSON.parse(manifest('1.2.3'))), '1.2.3');
  assert.equal(sdkVersion({}), undefined);
});

test('compareVersions returns no problem only for an exact match', () => {
  assert.deepEqual(compareVersions('1.2.3', '1.2.3'), []);
  assert.equal(compareVersions('1.2.3', '1.2.4').length, 1);
  assert.equal(compareVersions('1.2.3', '^1.2.3').length, 1);
  assert.equal(compareVersions(undefined, undefined).length, 1);
});

test('the real monolith worker passes', () => {
  const { image, sdk, problems } = checkSandboxVersion(REAL_WORKER);
  assert.deepEqual(problems, []);
  assert.equal(image, sdk);
});
