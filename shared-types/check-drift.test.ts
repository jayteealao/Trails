// Fixture cases of the schema drift check. Each case copies the passing tree of
// fixtures/drift/complete to a temp dir, breaks one file, runs the check on it
// with --root and asserts the exit code and the message.
//
// Run: node --experimental-strip-types --test shared-types/check-drift.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CHECK = join(here, 'check-drift.ts');
const COMPLETE = join(here, 'fixtures', 'drift', 'complete');

const GCS_METADATA = 'warg/workers/gcs/src/metadata.ts';
const GCS_TYPES = 'warg/workers/gcs/src/types.ts';
const GATEWAY_TYPES = 'warg/cloud-functions/archive-gateway/src/types.ts';
const BACKFILL_KEYS = 'warg/cloud-functions/backfill-scripts/src/keys.ts';
const TRIGGER_LINK = 'warg/cloud-functions/user-triggers/src/link.ts';
const ARCHIVE_SERVICE = 'android/app/src/main/java/com/jayteealao/trails/data/archive/ArchiveService.kt';

type Replacement = readonly [relativePath: string, from: string, to: string];

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCheck(args: readonly string[]): Run {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', CHECK, ...args], {
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// Copies the complete fixture, applies every replacement (each `from` must be
// present, and every occurrence is replaced), and runs the check on the copy.
function runOnFixture(replacements: readonly Replacement[]): Run {
  const dir = mkdtempSync(join(tmpdir(), 'drift-'));
  try {
    cpSync(COMPLETE, dir, { recursive: true });
    for (const [relativePath, from, to] of replacements) {
      const file = join(dir, relativePath);
      const src = readFileSync(file, 'utf8');
      assert.ok(src.includes(from), `fixture ${relativePath} does not contain ${JSON.stringify(from)}`);
      writeFileSync(file, src.split(from).join(to));
    }
    return runCheck(['--root', dir]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('(a) the real tree passes', () => {
  const run = runCheck([]);
  assert.equal(run.status, 0, run.stderr);
});

test('(b) the complete fixture passes', () => {
  const run = runOnFixture([]);
  assert.equal(run.status, 0, run.stderr);
});

test('(c) a metadata field found only inside a longer word in the gcs metadata builder is missing', () => {
  const run = runOnFixture([[GCS_METADATA, 'title', 'subtitle']]);
  assert.equal(run.status, 1, run.stderr);
  assert.ok(run.stderr.includes(GCS_METADATA), run.stderr);
  assert.ok(run.stderr.includes('title'), run.stderr);
});

test('(d) a metadata field found only inside a longer word in the archive gateway types is missing', () => {
  const run = runOnFixture([[GATEWAY_TYPES, 'byline', 'bylines']]);
  assert.equal(run.status, 1, run.stderr);
  assert.ok(run.stderr.includes(GATEWAY_TYPES), run.stderr);
  assert.ok(run.stderr.includes('byline'), run.stderr);
});

test('(e) a field missing from the gcs finalize request names that file only', () => {
  const run = runOnFixture([[GCS_TYPES, 'byline: string;', '']]);
  assert.equal(run.status, 1, run.stderr);
  assert.ok(run.stderr.includes(GCS_TYPES), run.stderr);
  assert.ok(run.stderr.includes('byline'), run.stderr);
  assert.ok(!run.stderr.includes(GCS_METADATA), run.stderr);
  assert.ok(!run.stderr.includes(GATEWAY_TYPES), run.stderr);
});

test('(f) the app reading a longer map key than the field is missing the field', () => {
  const run = runOnFixture([[ARCHIVE_SERVICE, '"excerpt"', '"excerpts"']]);
  assert.equal(run.status, 1, run.stderr);
  assert.ok(run.stderr.includes(ARCHIVE_SERVICE), run.stderr);
  assert.ok(run.stderr.includes('excerpt'), run.stderr);
});

test('(g) a marker field found only inside a longer word in the save trigger is missing', () => {
  const run = runOnFixture([[TRIGGER_LINK, 'source', 'sourceKind']]);
  assert.equal(run.status, 1, run.stderr);
  assert.ok(run.stderr.includes(TRIGGER_LINK), run.stderr);
  assert.ok(run.stderr.includes('source'), run.stderr);
});

test('(h) the marker collection found only inside a longer word in the backfill keys is missing', () => {
  const run = runOnFixture([[BACKFILL_KEYS, 'articleMarkers', 'articleMarkersLegacy']]);
  assert.equal(run.status, 1, run.stderr);
  assert.ok(run.stderr.includes(BACKFILL_KEYS), run.stderr);
  assert.ok(run.stderr.includes('articleMarkers'), run.stderr);
});
