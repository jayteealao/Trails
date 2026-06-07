/**
 * Cross-stack schema drift check.
 *
 * Verifies two contracts:
 *  1. The canonical Firestore field names in `shared-types/WargMetadata.md`
 *     appear in both the Warg producer (TypeScript) and the Trails consumer
 *     (Kotlin).
 *  2. The marker contract in `shared-types/MarkerSchema.md`
 *     (users/{uid}/articleMarkers/{key}) — its collection name and field names
 *     appear in the Trails marker writer (FirestoreBackupService.kt).
 *
 * This is a defensive smoke check, not a parser — it catches accidental
 * renames or typos but won't catch deeper semantic drift (type changes,
 * nullability mismatches).
 *
 * Run from monorepo root:
 *   node --experimental-strip-types shared-types/check-drift.ts
 *
 * Exit codes:
 *   0  — both sides reference all canonical fields
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
const TRAILS_MARKER_WRITER = resolve(
  repoRoot,
  'android/app/src/main/java/com/jayteealao/trails/services/firestore/FirestoreBackupService.kt',
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

// Marker field names are camelCase (e.g. `createdAt`), so they need a parser
// that allows uppercase letters — unlike the snake_case WargMetadata fields.
function extractMarkerFields(md: string): string[] {
  const fields: string[] = [];
  for (const line of md.split('\n')) {
    const match = line.match(/^\|\s*`([a-zA-Z_][a-zA-Z0-9_]*)`\s*\|/);
    if (match) fields.push(match[1]);
  }
  if (fields.length === 0) {
    console.error('[drift] no fields parsed from MarkerSchema.md — table format changed?');
    process.exit(1);
  }
  return fields;
}

function findMissing(haystack: string, needles: readonly string[]): string[] {
  return needles.filter((needle) => !haystack.includes(needle));
}

// Returns true if marker-contract drift was detected.
function checkMarkerContract(): boolean {
  const markerFields = extractMarkerFields(readFile(MARKER_DOC));
  console.log(`[drift] marker fields: ${markerFields.join(', ')}`);

  const writerSrc = readFile(TRAILS_MARKER_WRITER);
  let drift = false;

  if (!writerSrc.includes(MARKER_COLLECTION)) {
    console.error(
      `[drift] FirestoreBackupService.kt does not reference the marker collection "${MARKER_COLLECTION}".`,
    );
    drift = true;
  }

  const missing = findMissing(writerSrc, markerFields);
  if (missing.length > 0) {
    console.error(
      `[drift] FirestoreBackupService.kt is missing marker field name(s): ${missing.join(', ')}`,
    );
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

  if (drift) {
    console.error('[drift] FAIL — update shared-types/*.md or the affected source.');
    process.exit(1);
  }

  console.log('[drift] OK — metadata and marker contracts both intact.');
}

main();
