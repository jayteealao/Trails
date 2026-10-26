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
const repoRoot = resolve(here, '..');

const CANONICAL_DOC = resolve(here, 'WargMetadata.md');
const WARG_TYPES = resolve(repoRoot, 'warg/cloud-functions/archive-gateway/src/types.ts');
const TRAILS_SOURCE = resolve(
  repoRoot,
  'android/app/src/main/java/com/jayteealao/trails/data/archive/ArchiveService.kt',
);

// Marker contract: users/{uid}/articleMarkers/{key} — see MarkerSchema.md.
const MARKER_DOC = resolve(here, 'MarkerSchema.md');
const MARKER_COLLECTION = 'articleMarkers';
const CANONICAL_ID_FIELD = 'canonicalId';
// Server marker producer: the Warg Admin-SDK backfill. Its pure key module is
// the source of truth for the collection name + field body it writes.
const WARG_MARKER_BACKFILL = resolve(
  repoRoot,
  'warg/cloud-functions/backfill-scripts/src/keys.ts',
);
// Server marker producer: the Warg user-article trigger, which writes the
// marker in the same transaction as canonicalId.
const WARG_MARKER_TRIGGER = resolve(
  repoRoot,
  'warg/cloud-functions/user-triggers/src/link.ts',
);
// The app's backup writer and its Article model: neither may write markers or
// carry the server-owned canonicalId.
const TRAILS_BACKUP_WRITER = resolve(
  repoRoot,
  'android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreBackupService.kt',
);
const TRAILS_ARTICLE_MODEL = resolve(
  repoRoot,
  'android/app/src/main/java/com/jayteealao/trails/data/local/database/Article.kt',
);

// Trails only reads a subset of fields; fields listed here are exempt from
// the Trails-side check.
const TRAILS_OPTIONAL: ReadonlySet<string> = new Set(['published_time', 'site_name']);

function readFile(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    console.error(`[drift] could not read ${path}: ${(err as Error).message}`);
    process.exit(1);
  }
}

function extractCanonicalFields(md: string): string[] {
  // Pull names from the first markdown table column: lines that look like
  // "| `field_name` | ..." — backticks delimit the field name.
  const fields: string[] = [];
  for (const line of md.split('\n')) {
    const match = line.match(/^\|\s*`([a-z_][a-z0-9_]*)`\s*\|/);
    if (match) fields.push(match[1]);
  }
  if (fields.length === 0) {
    console.error('[drift] no fields parsed from WargMetadata.md — table format changed?');
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

function findMissing(haystack: string, needles: readonly string[]): string[] {
  return needles.filter((needle) => !haystack.includes(needle));
}

// Assert one marker producer references the collection name + every field.
// Returns true if drift was detected for that producer.
function checkMarkerProducer(
  label: string,
  path: string,
  markerFields: readonly string[],
): boolean {
  const src = readFile(path);
  let drift = false;

  if (!src.includes(MARKER_COLLECTION)) {
    console.error(
      `[drift] ${label} does not reference the marker collection "${MARKER_COLLECTION}".`,
    );
    drift = true;
  }

  const missing = findMissing(src, markerFields);
  if (missing.length > 0) {
    console.error(`[drift] ${label} is missing marker field name(s): ${missing.join(', ')}`);
    drift = true;
  }

  return drift;
}

// Returns true if marker-contract drift was detected in any producer.
function checkMarkerContract(): boolean {
  const markerFields = extractMarkerFields(readFile(MARKER_DOC));
  console.log(`[drift] marker fields: ${markerFields.join(', ')}`);

  // Every server producer must agree on the path + field names.
  const backfillDrift = checkMarkerProducer('backfill-scripts/src/keys.ts', WARG_MARKER_BACKFILL, markerFields);
  const triggerDrift = checkMarkerProducer('user-triggers/src/link.ts', WARG_MARKER_TRIGGER, markerFields);
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

  for (const [label, src] of [
    ['FirestoreBackupService.kt', backupSrc],
    ['ArchiveService.kt', archiveSrc],
  ] as const) {
    if (src.includes(MARKER_COLLECTION)) {
      console.error(`[drift] ${label} references "${MARKER_COLLECTION}"; the app must not write markers.`);
      drift = true;
    }
  }
  for (const [label, src] of [
    ['FirestoreBackupService.kt', backupSrc],
    ['Article.kt', articleSrc],
  ] as const) {
    if (src.includes(CANONICAL_ID_FIELD)) {
      console.error(`[drift] ${label} references "${CANONICAL_ID_FIELD}"; it is a server-owned field the app never stores or writes.`);
      drift = true;
    }
  }
  if (!archiveSrc.includes(CANONICAL_ID_FIELD)) {
    console.error(`[drift] ArchiveService.kt does not read "${CANONICAL_ID_FIELD}".`);
    drift = true;
  }
  if (!linkFields.includes(CANONICAL_ID_FIELD)) {
    console.error(`[drift] MarkerSchema.md "## Server-owned link fields" does not list "${CANONICAL_ID_FIELD}".`);
    drift = true;
  }

  return drift;
}

function main(): void {
  const canonical = extractCanonicalFields(readFile(CANONICAL_DOC));
  console.log(`[drift] canonical fields: ${canonical.join(', ')}`);

  const wargSrc = readFile(WARG_TYPES);
  const trailsSrc = readFile(TRAILS_SOURCE);

  const missingFromWarg = findMissing(wargSrc, canonical);
  const trailsRequired = canonical.filter((f) => !TRAILS_OPTIONAL.has(f));
  const missingFromTrails = findMissing(trailsSrc, trailsRequired);

  let drift = false;
  if (missingFromWarg.length > 0) {
    console.error(
      `[drift] Warg types.ts is missing canonical field(s): ${missingFromWarg.join(', ')}`,
    );
    drift = true;
  }
  if (missingFromTrails.length > 0) {
    console.error(
      `[drift] Trails ArchiveService.kt is missing canonical field(s): ${missingFromTrails.join(', ')}`,
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
