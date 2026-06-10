import process from 'node:process';

import type { DocumentReference, Firestore } from 'firebase-admin/firestore';

import { classifyDebugLogDoc } from './classify.js';
import { assertTargetEnv, getDb, isMain, parseArgs } from './firebase.js';

const DEBUG_LOGS_COLLECTION = 'debug_logs';
const SESSIONS_SUBCOLLECTION = 'sessions';

export interface CleanupOptions {
  readonly apply: boolean;
  readonly limit: number;
}

export interface CleanupResult {
  readonly scanned: number;
  readonly legacyFlat: number;
  readonly ownerParent: number;
  readonly unknown: number;
  readonly deleted: number;
  readonly errors: number;
  readonly sampleLegacyIds: string[];
  readonly apply: boolean;
}

/**
 * Delete legacy flat `debug_logs/{id}` docs left unreadable after the uid-scoped
 * migration. A doc is deleted only when it classifies as `legacy-flat`: the old
 * flat shape AND no `sessions` subcollection. `listDocuments()` surfaces
 * "missing" parents (a uid with only a `sessions` subcollection) so they are
 * seen and preserved as `owner-parent`. Deletion uses `recursiveDelete` to
 * sweep any stray subcollection under a legacy doc.
 */
export async function cleanupDebugLogs(
  db: Firestore,
  options: CleanupOptions,
): Promise<CleanupResult> {
  const { apply, limit } = options;
  const refs = await db.collection(DEBUG_LOGS_COLLECTION).listDocuments();

  let scanned = 0;
  let ownerParent = 0;
  let unknown = 0;
  let deleted = 0;
  let errors = 0;
  const sampleLegacyIds: string[] = [];
  const legacyRefs: DocumentReference[] = [];

  const CONCURRENCY = 20;
  const refsToScan = refs.slice(0, limit);

  // Fan out classification reads with bounded concurrency (CONCURRENCY docs in
  // flight at once) so the scan is not a strict sequential RTT waterfall.
  // Safety guards (legacy-flat-only delete, dry-run default) are unchanged —
  // they operate on the collected legacyRefs after all reads complete.
  for (let i = 0; i < refsToScan.length; i += CONCURRENCY) {
    const batch = refsToScan.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (ref) => {
        const [snapshot, subcollections] = await Promise.all([
          ref.get(),
          ref.listCollections(),
        ]);
        return { ref, snapshot, subcollections };
      }),
    );

    for (const { ref, snapshot, subcollections } of results) {
      scanned += 1;
      const hasSessions = subcollections.some((c) => c.id === SESSIONS_SUBCOLLECTION);
      const cls = classifyDebugLogDoc({
        id: ref.id,
        data: snapshot.exists ? snapshot.data() : undefined,
        hasSessionsSubcollection: hasSessions,
      });

      if (cls === 'legacy-flat') {
        legacyRefs.push(ref);
        if (sampleLegacyIds.length < 10) sampleLegacyIds.push(ref.id);
      } else if (cls === 'owner-parent') {
        ownerParent += 1;
      } else {
        unknown += 1;
      }
    }
  }

  if (apply) {
    for (const ref of legacyRefs) {
      try {
        await db.recursiveDelete(ref);
        deleted += 1;
        process.stderr.write(`  deleted ${ref.id} (${deleted}/${legacyRefs.length})\n`);
      } catch (error) {
        errors += 1;
        console.error(
          `[cleanup] failed to delete ${ref.id}: ${(error as Error).message}`,
        );
      }
    }
  }

  return {
    scanned,
    legacyFlat: legacyRefs.length,
    ownerParent,
    unknown,
    deleted,
    errors,
    sampleLegacyIds,
    apply,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  await assertTargetEnv(args.yes);
  const db = getDb();

  const result = await cleanupDebugLogs(db, { apply: args.apply, limit: args.limit });

  console.log(
    `[cleanup] mode=${args.apply ? 'APPLY' : 'dry-run'} scanned=${result.scanned} legacyFlat=${result.legacyFlat} ownerParent=${result.ownerParent} unknown=${result.unknown}`,
  );
  if (result.sampleLegacyIds.length > 0) {
    console.log(`[cleanup] sample legacy ids: ${result.sampleLegacyIds.join(', ')}`);
  }
  if (args.apply) {
    console.log(`[cleanup] deleted=${result.deleted} errors=${result.errors}`);
  } else {
    console.log('[cleanup] dry-run — pass --apply to delete the legacy-flat docs.');
  }
  if (result.errors > 0) process.exitCode = 1;
}

if (isMain(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
