/**
 * Cross-stack schema drift check.
 *
 * Verifies two contracts:
 *  1. The canonical Firestore field names in `shared-types/WargMetadata.md`
 *     appear in both the Warg producer (TypeScript) and the Trails consumer
 *     (Kotlin).
 *  2. The marker contract in `shared-types/MarkerSchema.md`
 *     (users/{uid}/articleMarkers/{key}) — its collection name and the field
 *     names of its "Firestore field names" table appear in every server marker
 *     producer (the Warg backfill key module and the user-article trigger's
 *     link module).
 *  3. The server-owned link contract — the app is not a marker producer
 *     (no `articleMarkers` in its backup or archive code), never carries
 *     `canonicalId` in its backup or its Article model, and reads `canonicalId`
 *     in ArchiveService.kt; the doc's "Server-owned link fields" table lists it.
 *
 * This is a defensive smoke check, not a parser — it catches accidental
 * renames or typos but won't catch deeper semantic drift (type changes,
 * nullability mismatches).
 *
 * Run from monorepo root:
 *   node --experimental-strip-types shared-types/check-drift.ts
 *
 * Exit codes:
 *   0  — every contract holds
 *   1  — drift detected (missing fields or canonical doc unparseable)
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const here = dirname(fileURLToPath(import.meta.url));

// The tree to check: the repo by default, or `--root <dir>` (resolved against
// the working directory), so a fixture tree with the same layout can be checked.
function parseRoot(argv: readonly string[]): string {
  const at = argv.indexOf('--root');
  if (at < 0) return resolve(here, '..');
  const value = argv[at + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error('[drift] usage: check-drift.ts [--root <dir>]');
    process.exit(1);
  }
  return resolve(process.cwd(), value);
}

const repoRoot = parseRoot(process.argv.slice(2));

// Every path below is relative to the checked tree; messages print it as is.
const CANONICAL_DOC = 'shared-types/WargMetadata.md';
// The metadata producers, each checked and named on its own: the gcs worker
// builds the map and types the finalize request; the archive gateway receives
// that request and writes it to the article document.
const METADATA_PRODUCERS: readonly { path: string; role: string }[] = [
  { path: 'warg/workers/gcs/src/metadata.ts', role: 'gcs worker metadata builder' },
  { path: 'warg/workers/gcs/src/types.ts', role: 'gcs worker finalize request' },
  {
    path: 'warg/cloud-functions/archive-gateway/src/types.ts',
    role: 'archive gateway finalize request and article document',
  },
];
const TRAILS_SOURCE =
  'android/app/src/main/java/com/jayteealao/trails/data/archive/ArchiveService.kt';

// Marker contract: users/{uid}/articleMarkers/{key} — see MarkerSchema.md.
const MARKER_DOC = 'shared-types/MarkerSchema.md';
const MARKER_COLLECTION = 'articleMarkers';
const CANONICAL_ID_FIELD = 'canonicalId';
// Server marker producer: the Warg Admin-SDK backfill. Its pure key module is
// the source of truth for the collection name + field body it writes.
const WARG_MARKER_BACKFILL = 'warg/cloud-functions/backfill-scripts/src/keys.ts';
// Server marker producer: the Warg user-article trigger, which writes the
// marker in the same transaction as canonicalId.
const WARG_MARKER_TRIGGER = 'warg/cloud-functions/user-triggers/src/link.ts';
// The app's backup writer and its Article model: neither may write markers or
// carry the server-owned canonicalId.
const TRAILS_BACKUP_WRITER =
  'android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreBackupService.kt';
const TRAILS_ARTICLE_MODEL =
  'android/app/src/main/java/com/jayteealao/trails/data/local/database/Article.kt';

// Trails only reads a subset of fields; fields listed here are exempt from
// the Trails-side check.
const TRAILS_OPTIONAL: ReadonlySet<string> = new Set(['published_time', 'site_name']);

function readFile(relativePath: string): string {
  try {
    return readFileSync(resolve(repoRoot, relativePath), 'utf8');
  } catch (err) {
    console.error(`[drift] could not read ${relativePath}: ${(err as Error).message}`);
    process.exit(1);
  }
}

// Whole-name matchers. A name never matches inside a longer word: `title` is
// not found in `subtitle`, and `byline` is not found in `bylines`.
function escapeRegExp(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The name as a whole identifier token.
function hasToken(src: string, name: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9_$])${escapeRegExp(name)}(?![A-Za-z0-9_$])`).test(src);
}

// The name as an object or type property key (`name:` or `name?:`), not as a
// member access such as `readability.name`.
function hasPropertyKey(src: string, name: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9_$.])${escapeRegExp(name)}\\??\\s*:`).test(src);
}

// The name as a whole string literal (`"name"` or `'name'`), such as a map key.
function hasStringLiteral(src: string, name: string): boolean {
  return new RegExp(`(["'])${escapeRegExp(name)}\\1`).test(src);
}

const METADATA_FIELDS_HEADING = 'Firestore field names (snake_case)';

function extractCanonicalFields(md: string): string[] {
  // Pull names from the first table column of the metadata section only: lines
  // that look like "| `field_name` | ..." — backticks delimit the field name.
  // The other tables of the doc (the articles document fields) are not metadata.
  const fields: string[] = [];
  for (const line of sectionLines(md, METADATA_FIELDS_HEADING)) {
    const match = line.match(/^\|\s*`([a-z_][a-z0-9_]*)`\s*\|/);
    if (match) fields.push(match[1]);
  }
  if (fields.length === 0) {
    console.error(`[drift] no fields parsed from WargMetadata.md "## ${METADATA_FIELDS_HEADING}" — table format changed?`);
    process.exit(1);
  }
  return fields;
}

// Lines of one "## <heading>" section of a markdown doc, up to the next "## ".
function sectionLines(md: string, heading: string): string[] {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return end < 0 ? rest : rest.slice(0, end);
}

// Field names of the first-column table rows in one section. Marker and link
// field names are camelCase (e.g. `createdAt`), so the parser allows uppercase
// letters — unlike the snake_case WargMetadata fields.
function extractSectionFields(md: string, heading: string): string[] {
  const fields: string[] = [];
  for (const line of sectionLines(md, heading)) {
    const match = line.match(/^\|\s*`([a-zA-Z_][a-zA-Z0-9_]*)`\s*\|/);
    if (match) fields.push(match[1]);
  }
  if (fields.length === 0) {
    console.error(`[drift] no fields parsed from MarkerSchema.md "## ${heading}" — table format changed?`);
    process.exit(1);
  }
  return fields;
}

function extractMarkerFields(md: string): string[] {
  return extractSectionFields(md, 'Firestore field names');
}

function extractLinkFields(md: string): string[] {
  return extractSectionFields(md, 'Server-owned link fields');
}

function findMissing(
  src: string,
  names: readonly string[],
  has: (src: string, name: string) => boolean,
): string[] {
  return names.filter((name) => !has(src, name));
}

// Assert one marker producer names the collection and every field as whole
// tokens. Returns true if drift was detected for that producer.
function checkMarkerProducer(path: string, markerFields: readonly string[]): boolean {
  const src = readFile(path);
  let drift = false;

  if (!hasToken(src, MARKER_COLLECTION)) {
    console.error(
      `[drift] ${path} does not reference the marker collection "${MARKER_COLLECTION}".`,
    );
    drift = true;
  }

  const missing = findMissing(src, markerFields, hasToken);
  if (missing.length > 0) {
    console.error(`[drift] ${path} is missing marker field name(s): ${missing.join(', ')}`);
    drift = true;
  }

  return drift;
}

// Returns true if marker-contract drift was detected in any producer.
function checkMarkerContract(): boolean {
  const markerFields = extractMarkerFields(readFile(MARKER_DOC));
  console.log(`[drift] marker fields: ${markerFields.join(', ')}`);

  // Every server producer must agree on the path + field names.
  const backfillDrift = checkMarkerProducer(WARG_MARKER_BACKFILL, markerFields);
  const triggerDrift = checkMarkerProducer(WARG_MARKER_TRIGGER, markerFields);
  return backfillDrift || triggerDrift;
}

// Returns true if the app breaks the server-owned link contract: it must not
// write markers or carry canonicalId, and it must read canonicalId.
function checkTrailsLinkContract(): boolean {
  const linkFields = extractLinkFields(readFile(MARKER_DOC));
  console.log(`[drift] server-owned link fields: ${linkFields.join(', ')}`);

  const backupSrc = readFile(TRAILS_BACKUP_WRITER);
  const archiveSrc = readFile(TRAILS_SOURCE);
  const articleSrc = readFile(TRAILS_ARTICLE_MODEL);
  let drift = false;

  for (const [path, src] of [
    [TRAILS_BACKUP_WRITER, backupSrc],
    [TRAILS_SOURCE, archiveSrc],
  ] as const) {
    if (hasToken(src, MARKER_COLLECTION)) {
      console.error(`[drift] ${path} references "${MARKER_COLLECTION}"; the app must not write markers.`);
      drift = true;
    }
  }
  for (const [path, src] of [
    [TRAILS_BACKUP_WRITER, backupSrc],
    [TRAILS_ARTICLE_MODEL, articleSrc],
  ] as const) {
    if (hasToken(src, CANONICAL_ID_FIELD)) {
      console.error(`[drift] ${path} references "${CANONICAL_ID_FIELD}"; it is a server-owned field the app never stores or writes.`);
      drift = true;
    }
  }
  if (!hasStringLiteral(archiveSrc, CANONICAL_ID_FIELD)) {
    console.error(`[drift] ${TRAILS_SOURCE} does not read "${CANONICAL_ID_FIELD}".`);
    drift = true;
  }
  if (!linkFields.includes(CANONICAL_ID_FIELD)) {
    console.error(`[drift] ${MARKER_DOC} "## Server-owned link fields" does not list "${CANONICAL_ID_FIELD}".`);
    drift = true;
  }

  return drift;
}

function main(): void {
  const canonical = extractCanonicalFields(readFile(CANONICAL_DOC));
  console.log(`[drift] canonical fields: ${canonical.join(', ')}`);

  let drift = false;
  for (const { path, role } of METADATA_PRODUCERS) {
    const missing = findMissing(readFile(path), canonical, hasPropertyKey);
    if (missing.length > 0) {
      console.error(`[drift] ${path} (${role}) is missing canonical field(s): ${missing.join(', ')}`);
      drift = true;
    }
  }

  const trailsSrc = readFile(TRAILS_SOURCE);
  const trailsRequired = canonical.filter((f) => !TRAILS_OPTIONAL.has(f));
  const missingFromTrails = findMissing(trailsSrc, trailsRequired, hasStringLiteral);
  if (missingFromTrails.length > 0) {
    console.error(
      `[drift] ${TRAILS_SOURCE} is missing canonical field(s): ${missingFromTrails.join(', ')}`,
    );
    drift = true;
  }

  // Marker contract (users/{uid}/articleMarkers/{key}).
  if (checkMarkerContract()) {
    drift = true;
  }

  // Server-owned link contract (canonicalId; the app is not a marker producer).
  if (checkTrailsLinkContract()) {
    drift = true;
  }

  if (drift) {
    console.error('[drift] FAIL — update shared-types/*.md or the affected source.');
    process.exit(1);
  }

  console.log('[drift] OK — metadata, marker and server-owned link contracts intact.');
}

main();
