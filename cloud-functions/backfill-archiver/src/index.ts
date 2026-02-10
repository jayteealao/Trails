import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { DocumentReference, DocumentData } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineString, defineInt } from 'firebase-functions/params';

// Initialize Firebase Admin
if (getApps().length === 0) {
  initializeApp();
}

// Configuration
const GATEWAY_URL = defineString('GATEWAY_URL', {
  default: 'https://gateway.jayteealao.workers.dev',
});
const PUBLIC_API_KEY = defineString('PUBLIC_API_KEY');
const USER_ID = 'TGtRF6GrQaSmfjGk9GEYJ8YZc0v1';
const BATCH_SIZE = defineInt('BACKFILL_BATCH_SIZE', { default: 50 });
const STAGGER_MS = 500;

/**
 * Extract domain from URL (hostname without www.)
 */
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check which article IDs don't have a corresponding shared article doc.
 * Uses batch getAll() for efficiency (up to 500 per call).
 */
async function findUnarchivedIds(
  db: FirebaseFirestore.Firestore,
  itemIds: string[]
): Promise<Set<string>> {
  const missing = new Set<string>();
  const chunkSize = 500;

  for (let i = 0; i < itemIds.length; i += chunkSize) {
    const chunk = itemIds.slice(i, i + chunkSize);
    const refs: DocumentReference[] = chunk.map((id) =>
      db.collection('articles').doc(id)
    );
    const snapshots = await db.getAll(...refs);

    for (const snap of snapshots) {
      if (!snap.exists) {
        missing.add(snap.id);
      }
    }
  }

  return missing;
}

/**
 * Scheduled function: find unarchived user articles and trigger archival.
 *
 * Runs every 10 minutes. Each invocation processes up to BATCH_SIZE articles
 * that exist in the user's collection but not in the shared articles collection.
 * Creates the shared article doc (with pocket data) and calls gateway /begin.
 */
export const backfillArchiver = onSchedule(
  {
    schedule: 'every 10 minutes',
    timeZone: 'UTC',
    retryCount: 0,
    timeoutSeconds: 540,
  },
  async () => {
    const db = getFirestore();
    const batchSize = BATCH_SIZE.value();

    console.log(`[backfill] Starting backfill run (batch size: ${batchSize})`);

    // 1. Query all user articles
    const userArticlesRef = db
      .collection('users')
      .doc(USER_ID)
      .collection('articles');

    const userArticlesSnap = await userArticlesRef.get();
    const allUserArticles = userArticlesSnap.docs;

    if (allUserArticles.length === 0) {
      console.log('[backfill] No user articles found');
      return;
    }

    console.log(`[backfill] Found ${allUserArticles.length} total user articles`);

    // 2. Find which ones don't have a shared article doc
    const allIds = allUserArticles.map((doc) => doc.id);
    const unarchivedIds = await findUnarchivedIds(db, allIds);

    if (unarchivedIds.size === 0) {
      console.log('[backfill] All articles already archived');
      return;
    }

    console.log(
      `[backfill] Found ${unarchivedIds.size} unarchived articles, processing up to ${batchSize}`
    );

    // 3. Process up to BATCH_SIZE unarchived articles
    const toProcess = allUserArticles.filter((doc) => unarchivedIds.has(doc.id));
    const batch = toProcess.slice(0, batchSize);

    let successes = 0;
    let failures = 0;
    let skipped = 0;

    for (let i = 0; i < batch.length; i++) {
      const userDoc = batch[i]!;
      const itemId = userDoc.id;
      const data = userDoc.data();
      const url = data['url'] as string | undefined;

      if (!url) {
        console.warn(`[backfill] Skipping ${itemId}: no URL`);
        skipped++;
        continue;
      }

      try {
        // 3a. Create shared article doc (replicating user-triggers)
        const domain = extractDomain(url);
        const pocket = {
          favorite: data['favorite'] ?? '',
          resolved_id: data['resolvedId'] ?? '',
          status: data['status'] ?? '',
          time_added: data['timeAdded'] ?? 0,
          time_read: data['timeRead'] ?? 0,
        };

        const articleRef = db.collection('articles').doc(itemId);
        await articleRef.set({
          item_id: itemId,
          url,
          domain,
          created_at: Timestamp.now(),
          status: 'pending',
          archives: {},
          pocket,
          stats: {
            last_accessed: '',
            total_saves: 1,
            total_views: 0,
          },
        });

        // 3b. Call gateway /begin
        const response = await fetch(`${GATEWAY_URL.value()}/begin`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': PUBLIC_API_KEY.value(),
          },
          body: JSON.stringify({
            url,
            request_id: itemId,
            includeScreenshot: true,
            includePdf: true,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Gateway error: ${errorText}`);
        }

        const { requestId } = (await response.json()) as { requestId: string };

        // 3c. Update shared article with warg request ID
        await articleRef.update({
          warg_request_id: requestId,
          status: 'processing',
          processing_started_at: Timestamp.now(),
        });

        // 3d. Mark user article as triggered
        await userDoc.ref.update({
          resolvedId: itemId,
          archival_triggered: true,
        });

        successes++;
        console.log(`[backfill] [${i + 1}/${batch.length}] Triggered ${itemId}`);
      } catch (error) {
        failures++;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[backfill] [${i + 1}/${batch.length}] Failed ${itemId}: ${message}`);

        // Mark shared article as failed if it was created
        const articleRef = db.collection('articles').doc(itemId);
        const articleDoc = await articleRef.get();
        if (articleDoc.exists && articleDoc.data()?.['status'] === 'pending') {
          await articleRef.update({
            status: 'failed',
            error: message,
            failed_at: Timestamp.now(),
          });
        }
      }

      // Stagger between calls (skip delay after last item)
      if (i < batch.length - 1) {
        await sleep(STAGGER_MS);
      }
    }

    console.log(
      `[backfill] Done: ${successes} ok, ${failures} failed, ${skipped} skipped out of ${batch.length} (${unarchivedIds.size} total remaining)`
    );
  }
);
