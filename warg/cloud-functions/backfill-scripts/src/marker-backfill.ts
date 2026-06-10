import process from 'node:process';

import type { Firestore } from 'firebase-admin/firestore';

import {
  extractResolvedId,
  markersCollection,
  readExistingMarkerKeys,
  streamUserArticles,
} from './articles.js';
import { assertTargetEnv, getDb, isMain, parseArgs } from './firebase.js';
import { deriveMarkerKeys, markerBody } from './keys.js';

export interface BackfillOptions {
  readonly user: string;
  readonly apply: boolean;
  readonly limit: number;
  readonly pageSize?: number;
}

export interface BackfillResult {
  readonly articles: number;
  /** Total marker keys derived across all scanned articles. */
  readonly expectedKeys: number;
  /** Keys that already had a marker (skipped — never re-written or clobbered). */
  readonly alreadyPresent: number;
  /** Markers enqueued and confirmed written (`--apply` only). */
  readonly written: number;
  /** Missing markers that would be written (dry-run only). */
  readonly wouldWrite: number;
  readonly errors: number;
  readonly sampleKeys: string[];
  readonly apply: boolean;
}

/**
 * Write a marker for every missing key of the target user's articles.
 *
 * Reads the user's existing markers once, then writes ONLY missing keys via a
 * `BulkWriter` (auto-throttle + retry), so existing markers keep their original
 * `source`/`createdAt`. Never deletes. Dry-run (`apply: false`) counts without
 * writing.
 */
export async function backfillMarkers(
  db: Firestore,
  options: BackfillOptions,
): Promise<BackfillResult> {
  const { user, apply, limit } = options;
  const pageSize = options.pageSize ?? 250;

  // `existing` doubles as an in-run dedup set: a resolvedId shared by two
  // articles is written once, then counted as already-present thereafter.
  const existing = await readExistingMarkerKeys(db, user);
  const markers = markersCollection(db, user);

  let articles = 0;
  let expectedKeys = 0;
  let alreadyPresent = 0;
  let toWrite = 0;
  let errors = 0;
  const sampleKeys: string[] = [];

  const writer = apply ? db.bulkWriter() : null;
  if (writer) {
    // Attach BEFORE enqueuing any op. BulkWriter auto-retries UNAVAILABLE/
    // ABORTED internally; this decides when to give up and surfaces a count.
    writer.onWriteError((error) => {
      if (error.failedAttempts < 10) return true;
      errors += 1;
      console.error(
        `[backfill] write failed (${error.failedAttempts} attempts) ${error.documentRef.path}: ${error.message}`,
      );
      return false;
    });
  }

  for await (const doc of streamUserArticles(db, user, pageSize)) {
    if (articles >= limit) break;
    articles += 1;

    const articleItemId = doc.id;
    const keys = deriveMarkerKeys(articleItemId, extractResolvedId(doc.data()));
    for (const key of keys) {
      expectedKeys += 1;
      if (existing.has(key)) {
        alreadyPresent += 1;
        continue;
      }

      if (sampleKeys.length < 10) sampleKeys.push(key);
      toWrite += 1;
      existing.add(key);

      if (writer) {
        // Merge keeps the write idempotent. onWriteError handles the retry
        // decision; the per-op `.catch` only absorbs the final rejection so a
        // give-up does not surface as an unhandled rejection.
        // Both the itemId-keyed and resolvedId-keyed markers carry the same
        // articleItemId for schema parity (Admin SDK bypasses rules).
        writer
          .set(markers.doc(key), markerBody(key, articleItemId), { merge: true })
          .catch(() => undefined);
      }
    }
  }

  if (writer) {
    await writer.close();
  }

  return {
    articles,
    expectedKeys,
    alreadyPresent,
    written: apply ? toWrite - errors : 0,
    wouldWrite: apply ? 0 : toWrite,
    errors,
    sampleKeys,
    apply,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  await assertTargetEnv(args.yes);
  const db = getDb();

  const result = await backfillMarkers(db, {
    user: args.user,
    apply: args.apply,
    limit: args.limit,
  });

  console.log(`[backfill] user=${args.user} mode=${args.apply ? 'APPLY' : 'dry-run'}`);
  const counts = args.apply
    ? `written=${result.written} errors=${result.errors}`
    : `wouldWrite=${result.wouldWrite}`;
  console.log(
    `[backfill] articles=${result.articles} expectedKeys=${result.expectedKeys} alreadyPresent=${result.alreadyPresent} ${counts}`,
  );
  if (result.sampleKeys.length > 0) {
    console.log(`[backfill] sample missing keys: ${result.sampleKeys.join(', ')}`);
  }
  if (!args.apply) {
    console.log('[backfill] dry-run — pass --apply to write the missing markers.');
  }
  if (result.errors > 0) process.exitCode = 1;
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
