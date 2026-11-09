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
const USER_ARTICLE_WIRE = 'android/app/src/main/java/com/jayteealao/trails/services/firestore/UserArticleWire.kt';

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

const FIXTURE_DOC = 'shared-types/WargMetadata.md';
const PUBLISHED_TIME_ROW =
  '| `published_time` | `android/app/src/main/java/com/jayteealao/trails/data/archive/ArchiveService.kt` | fixture: the app does not read the published time |';
const SITE_NAME_ROW =
  '| `site_name` | `android/app/src/main/java/com/jayteealao/trails/data/archive/ArchiveService.kt` | fixture: the app does not read the site name |';

test('(i) an accepted difference with no reason fails and names its field', () => {
  const run = runOnFixture([[FIXTURE_DOC, 'fixture: the app does not read the published time', ' ']]);
  assert.equal(run.status, 1, run.stderr);
  assert.ok(run.stderr.includes('`published_time`'), run.stderr);
  assert.ok(run.stderr.includes('no reason'), run.stderr);
});

test('(j) an accepted difference for a field the file now has is stale', () => {
  const run = runOnFixture([
    [
      ARCHIVE_SERVICE,
      'leadImage = metadata["lead_image"] as? String,',
      'leadImage = metadata["lead_image"] as? String, siteName = metadata["site_name"] as? String,',
    ],
  ]);
  assert.equal(run.status, 1, run.stderr);
  assert.ok(run.stderr.includes('`site_name`'), run.stderr);
  assert.ok(run.stderr.includes('stale'), run.stderr);
  assert.ok(run.stderr.includes('remove the accepted-differences row'), run.stderr);
});

test('(k) without the accepted differences the app is missing published_time and site_name', () => {
  const run = runOnFixture([
    [FIXTURE_DOC, PUBLISHED_TIME_ROW, ''],
    [FIXTURE_DOC, SITE_NAME_ROW, ''],
  ]);
  assert.equal(run.status, 1, run.stderr);
  assert.ok(run.stderr.includes(ARCHIVE_SERVICE), run.stderr);
  assert.ok(run.stderr.includes('published_time'), run.stderr);
  assert.ok(run.stderr.includes('site_name'), run.stderr);
});

test('(l) an accepted difference naming an unknown field fails', () => {
  const run = runOnFixture([[FIXTURE_DOC, '| `site_name` | `android', '| `not_a_field` | `android']]);
  assert.equal(run.status, 1, run.stderr);
  assert.ok(run.stderr.includes('`not_a_field`'), run.stderr);
  assert.ok(run.stderr.includes('not in "## Firestore field names (snake_case)"'), run.stderr);
});

test('(m) an accepted difference naming a file the check does not read fails', () => {
  const run = runOnFixture([
    [FIXTURE_DOC, '| `site_name` | `android/app/src/main/java/com/jayteealao/trails/data/archive/ArchiveService.kt`', '| `site_name` | `android/app/src/main/java/Other.kt`'],
  ]);
  assert.equal(run.status, 1, run.stderr);
  assert.ok(run.stderr.includes('android/app/src/main/java/Other.kt'), run.stderr);
  assert.ok(run.stderr.includes('not a metadata file the check reads'), run.stderr);
});

test('(h) the marker collection found only inside a longer word in the backfill keys is missing', () => {
  const run = runOnFixture([[BACKFILL_KEYS, 'articleMarkers', 'articleMarkersLegacy']]);
  assert.equal(run.status, 1, run.stderr);
  assert.ok(run.stderr.includes(BACKFILL_KEYS), run.stderr);
  assert.ok(run.stderr.includes('articleMarkers'), run.stderr);
});

const USER_ARTICLE_SECTION = `## User article fields read by the server

The app writes these names on the user article through \`UserArticleWire.kt\`.

| Field | Read by |
| ----- | ------- |
| \`url\` | fixture |
| \`title\` | fixture |
| \`favorite\` | fixture |
| \`status\` | fixture |
| \`timeAdded\` | fixture |
| \`timeRead\` | fixture |
| \`timeUpdated\` | fixture |
| \`deletedAt\` | fixture |

`;

test('(n) a user-article field renamed in the app wire type fails and names the file', () => {
  const run = runOnFixture([[USER_ARTICLE_WIRE, '"timeUpdated"', '"timeUpdatedAt"']]);
  assert.equal(run.status, 1, run.stderr);
  assert.ok(run.stderr.includes(USER_ARTICLE_WIRE), run.stderr);
  assert.ok(run.stderr.includes('timeUpdated'), run.stderr);
});

test('(o) the app wire type carrying the server-owned link fails and names the file', () => {
  const run = runOnFixture([
    [USER_ARTICLE_WIRE, 'const val URL = "url"', 'const val URL = "url"\n        const val LINK = "canonicalId"'],
  ]);
  assert.equal(run.status, 1, run.stderr);
  assert.ok(run.stderr.includes(USER_ARTICLE_WIRE), run.stderr);
  assert.ok(run.stderr.includes('canonicalId'), run.stderr);
});

test('(p) without the user-article fields section the check fails and names the section', () => {
  const run = runOnFixture([[FIXTURE_DOC, USER_ARTICLE_SECTION, '']]);
  assert.equal(run.status, 1, run.stderr);
  assert.ok(run.stderr.includes('User article fields read by the server'), run.stderr);
});

test('(q) a user-article field found only inside a longer literal is missing', () => {
  const run = runOnFixture([[USER_ARTICLE_WIRE, '"url"', '"urls"']]);
  assert.equal(run.status, 1, run.stderr);
  assert.ok(run.stderr.includes(USER_ARTICLE_WIRE), run.stderr);
  assert.ok(run.stderr.includes('url'), run.stderr);
});

test('(r) a user-article reader file that does not exist fails and names the row', () => {
  const run = runOnFixture([[FIXTURE_DOC, '| `url` | fixture |', '| `url` | `user-triggers/src/gone.ts` |']]);
  assert.equal(run.status, 1, run.stderr);
  assert.ok(run.stderr.includes('user-triggers/src/gone.ts'), run.stderr);
  assert.ok(run.stderr.includes('`url`'), run.stderr);
});

test('(s) a user-article reader file that does not name its field fails', () => {
  const run = runOnFixture([[FIXTURE_DOC, '| `timeRead` | fixture |', '| `timeRead` | `user-triggers/src/link.ts` |']]);
  assert.equal(run.status, 1, run.stderr);
  assert.ok(run.stderr.includes('does not name timeRead'), run.stderr);
});

test('(t) a user-article reader file that names its field passes', () => {
  const run = runOnFixture([[FIXTURE_DOC, '| `title` | fixture |', '| `title` | `archive-gateway/src/types.ts` (`FinalizeRequest`) |']]);
  assert.equal(run.status, 0, run.stderr);
});
