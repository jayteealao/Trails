import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { DocumentReference, DocumentData } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { defineString, defineInt } from 'firebase-functions/params';

// Initialize Firebase Admin
if (getApps().length === 0) {
  initializeApp();
}

// ── Configuration ──

const GATEWAY_URL = defineString('GATEWAY_URL', {
  default: 'https://gateway.jayteealao.workers.dev',
});
const PUBLIC_API_KEY = defineString('PUBLIC_API_KEY');
const INTERNAL_API_KEY = defineString('INTERNAL_API_KEY');
const USER_ID = 'TGtRF6GrQaSmfjGk9GEYJ8YZc0v1';
const BATCH_SIZE = defineInt('BACKFILL_BATCH_SIZE', { default: 25 });
const STAGGER_MS = 2000;
const TRACKER_DOC_PATH = 'backfill_state/tracker';
const MAX_RETRIES = 2;
const STUCK_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const CORE_ARCHIVES = ['rendered', 'readability', 'markdown', 'singlefile'] as const;

// ── Types ──

interface BatchEntry {
  item_id: string;
  url: string;
  sent_at: Timestamp;
  retry_count: number;
}

interface BackfillTracker {
  batch: BatchEntry[];
  batch_started_at: Timestamp | null;
  batch_number: number;
  total_sent: number;
  total_completed: number;
  total_failed: number;
  consecutive_all_failed: number;
  last_run_at: Timestamp;
  last_run_result: 'sent_batch' | 'waiting' | 'settled' | 'idle' | 'backoff';
}

type ItemStatus = 'complete' | 'failed' | 'stuck' | 'in_progress';

interface BatchSettlement {
  complete: number;
  failed: number;
  stuck: number;
  inProgress: number;
  stuckIds: string[];
}

interface EligibleItem {
  isNew: boolean;
  retryCount: number;
}

// ── Utilities ──

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

function createDefaultTracker(): BackfillTracker {
  return {
    batch: [],
    batch_started_at: null,
    batch_number: 0,
    total_sent: 0,
    total_completed: 0,
    total_failed: 0,
    consecutive_all_failed: 0,
    last_run_at: Timestamp.now(),
    last_run_result: 'idle',
  };
}

// ── Completion detection ──

/**
 * Classify an article's archival status based on its Firestore doc.
 * Complete = metadata.title present + all 4 core archives succeeded.
 */
function classifyItem(doc: DocumentData | undefined): ItemStatus {
  if (!doc) return 'failed';

  const status = doc['status'] as string | undefined;
  const metadata = doc['metadata'] as Record<string, unknown> | undefined;
  const archives = doc['archives'] as
    | Record<string, { status: string }>
    | undefined;
  const processingStartedAt = doc['processing_started_at'] as
    | Timestamp
    | undefined;

  // Complete: metadata with title + all core archives succeeded
  if (metadata && metadata['title'] && archives) {
    const hasAllCore = CORE_ARCHIVES.every(
      (key) => archives[key]?.status === 'success'
    );
    if (hasAllCore) return 'complete';
  }

  if (status === 'failed') return 'failed';

  // Stuck: processing too long without completion
  if (status === 'processing' && processingStartedAt) {
    const elapsed = Date.now() - processingStartedAt.toMillis();
    if (elapsed > STUCK_TIMEOUT_MS) return 'stuck';
  }

  return 'in_progress';
}

/**
 * Check all items in a batch and return settlement counts.
 */
async function checkBatchSettlement(
  db: FirebaseFirestore.Firestore,
  batch: BatchEntry[]
): Promise<BatchSettlement> {
  const refs = batch.map((e) => db.collection('articles').doc(e.item_id));
  const snapshots = await db.getAll(...refs);

  const result: BatchSettlement = {
    complete: 0,
    failed: 0,
    stuck: 0,
    inProgress: 0,
    stuckIds: [],
  };

  for (const snap of snapshots) {
    const classification = classifyItem(snap.exists ? snap.data() : undefined);
    switch (classification) {
      case 'complete':
        result.complete++;
        break;
      case 'failed':
        result.failed++;
        break;
      case 'stuck':
        result.stuck++;
        result.stuckIds.push(snap.id);
        break;
      case 'in_progress':
        result.inProgress++;
        break;
    }
  }

  console.log(
    `[backfill] Batch check: ${result.complete} complete, ${result.failed} failed, ` +
      `${result.stuck} stuck, ${result.inProgress} in-progress`
  );

  return result;
}

/**
 * Mark stuck items as failed so they become eligible for retry.
 */
async function markStuckAsFailed(
  db: FirebaseFirestore.Firestore,
  stuckIds: string[]
): Promise<void> {
  for (const id of stuckIds) {
    await db.collection('articles').doc(id).update({
      status: 'failed',
      error: 'Stuck: no completion after 30 minutes',
      failed_at: Timestamp.now(),
    });
  }
}

// ── Eligibility ──

/**
 * Find article IDs eligible for processing:
 * - No articles/{id} doc (never sent)
 * - Doc exists with status='failed' and retry_count < MAX_RETRIES
 * - Doc exists with status='processing' but stuck (>30 min) and retry_count < MAX_RETRIES
 */
async function findEligibleIds(
  db: FirebaseFirestore.Firestore,
  itemIds: string[]
): Promise<Map<string, EligibleItem>> {
  const eligible = new Map<string, EligibleItem>();
  const chunkSize = 500;

  for (let i = 0; i < itemIds.length; i += chunkSize) {
    const chunk = itemIds.slice(i, i + chunkSize);
    const refs: DocumentReference[] = chunk.map((id) =>
      db.collection('articles').doc(id)
    );
    const snapshots = await db.getAll(...refs);

    for (const snap of snapshots) {
      if (!snap.exists) {
        eligible.set(snap.id, { isNew: true, retryCount: 0 });
        continue;
      }

      const data = snap.data()!;
      const status = data['status'] as string | undefined;
      const retryCount = (data['retry_count'] as number | undefined) ?? 0;

      if (status === 'failed' && retryCount < MAX_RETRIES) {
        eligible.set(snap.id, { isNew: false, retryCount });
      } else if (status === 'processing') {
        // Detect stuck items (processing > 30 min without completion)
        const processingStartedAt = data['processing_started_at'] as
          | Timestamp
          | undefined;
        if (processingStartedAt) {
          const elapsed = Date.now() - processingStartedAt.toMillis();
          if (elapsed > STUCK_TIMEOUT_MS && retryCount < MAX_RETRIES) {
            eligible.set(snap.id, { isNew: false, retryCount });
          }
        }
      }
    }
  }

  return eligible;
}

// ── Main function ──

/**
 * Scheduled backfill: tracks batches, checks completion, retries failures.
 *
 * Phase 1 — CHECK: If an active batch exists, check settlement.
 * Phase 2 — GATE:  If paused due to consecutive failures, skip.
 * Phase 3 — SEND:  Find eligible items and send a new batch.
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
    const trackerRef = db.doc(TRACKER_DOC_PATH);

    console.log(`[backfill] Starting run (batch size: ${batchSize})`);

    // Load or create tracker
    const trackerSnap = await trackerRef.get();
    const tracker: BackfillTracker = trackerSnap.exists
      ? (trackerSnap.data() as BackfillTracker)
      : createDefaultTracker();

    // ── Phase 1: CHECK active batch ──

    if (tracker.batch.length > 0) {
      console.log(
        `[backfill] Checking batch #${tracker.batch_number} (${tracker.batch.length} items)`
      );
      const settlement = await checkBatchSettlement(db, tracker.batch);

      // Mark stuck items as failed in Firestore
      if (settlement.stuckIds.length > 0) {
        await markStuckAsFailed(db, settlement.stuckIds);
        console.log(
          `[backfill] Marked ${settlement.stuckIds.length} stuck items as failed`
        );
      }

      // Still waiting for some items to finish
      if (settlement.inProgress > 0) {
        console.log(`[backfill] Waiting for ${settlement.inProgress} items`);
        await trackerRef.set({
          ...tracker,
          last_run_at: Timestamp.now(),
          last_run_result: 'waiting',
        });
        return;
      }

      // All settled — update lifetime counters
      tracker.total_completed += settlement.complete;
      tracker.total_failed += settlement.failed + settlement.stuck;

      const allFailed = settlement.complete === 0;

      if (allFailed) {
        if (tracker.consecutive_all_failed === 0) {
          // First all-fail: retry the same batch
          console.warn(
            `[backfill] All items failed in batch #${tracker.batch_number}. Retrying same batch.`
          );

          const retryEntries: BatchEntry[] = [];
          let retrySuccesses = 0;
          let retryFailures = 0;

          for (let i = 0; i < tracker.batch.length; i++) {
            const entry = tracker.batch[i]!;

            // Skip if article doc was deleted externally
            const articleSnap = await db
              .collection('articles')
              .doc(entry.item_id)
              .get();
            if (!articleSnap.exists) {
              console.warn(
                `[backfill] [retry] Skipping ${entry.item_id}: article doc not found`
              );
              retryFailures++;
              if (i < tracker.batch.length - 1) await sleep(STAGGER_MS);
              continue;
            }

            try {
              const response = await fetch(`${GATEWAY_URL.value()}/begin`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-API-Key': PUBLIC_API_KEY.value(),
                },
                body: JSON.stringify({
                  url: entry.url,
                  request_id: entry.item_id,
                  includeScreenshot: true,
                  includePdf: true,
                }),
              });

              if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Gateway error: ${errorText}`);
              }

              const { requestId } = (await response.json()) as {
                requestId: string;
              };

              await db
                .collection('articles')
                .doc(entry.item_id)
                .update({
                  warg_request_id: requestId,
                  status: 'processing',
                  processing_started_at: Timestamp.now(),
                  retry_count: entry.retry_count + 1,
                });

              retryEntries.push({
                item_id: entry.item_id,
                url: entry.url,
                sent_at: Timestamp.now(),
                retry_count: entry.retry_count + 1,
              });
              retrySuccesses++;
              console.log(
                `[backfill] [retry ${i + 1}/${tracker.batch.length}] Triggered ${entry.item_id}`
              );
            } catch (error) {
              retryFailures++;
              const message =
                error instanceof Error ? error.message : String(error);
              console.error(
                `[backfill] [retry ${i + 1}/${tracker.batch.length}] Failed ${entry.item_id}: ${message}`
              );

              await db
                .collection('articles')
                .doc(entry.item_id)
                .update({
                  status: 'failed',
                  error: message,
                  failed_at: Timestamp.now(),
                  retry_count: entry.retry_count + 1,
                });
            }

            if (i < tracker.batch.length - 1) await sleep(STAGGER_MS);
          }

          console.log(
            `[backfill] Retry: ${retrySuccesses} ok, ${retryFailures} failed`
          );

          // If all retries also failed at gateway, jump straight to pause threshold
          const newConsecutive = retryEntries.length > 0 ? 1 : 2;

          await trackerRef.set({
            ...tracker,
            batch: retryEntries,
            batch_started_at:
              retryEntries.length > 0 ? Timestamp.now() : null,
            consecutive_all_failed: newConsecutive,
            last_run_at: Timestamp.now(),
            last_run_result:
              retryEntries.length > 0 ? 'sent_batch' : 'backoff',
          });
          return;
        }

        // Second+ consecutive all-fail: pause
        console.error(
          `[backfill] PAUSED: ${tracker.consecutive_all_failed + 1} consecutive all-fail batches. ` +
            `Reset consecutive_all_failed in ${TRACKER_DOC_PATH} to resume.`
        );
        await trackerRef.set({
          ...tracker,
          batch: [],
          batch_started_at: null,
          consecutive_all_failed: tracker.consecutive_all_failed + 1,
          last_run_at: Timestamp.now(),
          last_run_result: 'backoff',
        });
        return;
      }

      // Some succeeded — reset failure counter, clear batch
      console.log(
        `[backfill] Batch #${tracker.batch_number} settled: ` +
          `${settlement.complete} complete, ${settlement.failed + settlement.stuck} failed`
      );
      tracker.batch = [];
      tracker.batch_started_at = null;
      tracker.consecutive_all_failed = 0;
    }

    // ── Phase 2: GATE ──

    if (tracker.consecutive_all_failed >= 2) {
      console.warn(
        `[backfill] Still paused (${tracker.consecutive_all_failed} consecutive failures). ` +
          `Reset consecutive_all_failed in ${TRACKER_DOC_PATH} to resume.`
      );
      await trackerRef.set({
        ...tracker,
        last_run_at: Timestamp.now(),
        last_run_result: 'backoff',
      });
      return;
    }

    // ── Phase 3: SEND new batch ──

    const userArticlesRef = db
      .collection('users')
      .doc(USER_ID)
      .collection('articles');

    const userArticlesSnap = await userArticlesRef.get();
    const allUserArticles = userArticlesSnap.docs;

    if (allUserArticles.length === 0) {
      console.log('[backfill] No user articles found');
      await trackerRef.set({
        ...tracker,
        last_run_at: Timestamp.now(),
        last_run_result: 'idle',
      });
      return;
    }

    console.log(
      `[backfill] Found ${allUserArticles.length} total user articles`
    );

    const allIds = allUserArticles.map((doc) => doc.id);
    const eligibleMap = await findEligibleIds(db, allIds);

    if (eligibleMap.size === 0) {
      console.log('[backfill] All articles archived or at max retries');
      await trackerRef.set({
        ...tracker,
        last_run_at: Timestamp.now(),
        last_run_result: 'idle',
      });
      return;
    }

    console.log(
      `[backfill] Found ${eligibleMap.size} eligible articles, processing up to ${batchSize}`
    );

    const toProcess = allUserArticles.filter((doc) => eligibleMap.has(doc.id));
    const itemsToSend = toProcess.slice(0, batchSize);

    let successes = 0;
    let failures = 0;
    let skipped = 0;
    const batchEntries: BatchEntry[] = [];

    for (let i = 0; i < itemsToSend.length; i++) {
      const userDoc = itemsToSend[i]!;
      const itemId = userDoc.id;
      const data = userDoc.data();
      const url = data['url'] as string | undefined;

      if (!url) {
        console.warn(`[backfill] Skipping ${itemId}: no URL`);
        skipped++;
        continue;
      }

      const eligibility = eligibleMap.get(itemId)!;
      const newRetryCount = eligibility.isNew
        ? 0
        : eligibility.retryCount + 1;

      try {
        // Create/overwrite shared article doc
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
          retry_count: newRetryCount,
          stats: {
            last_accessed: '',
            total_saves: 1,
            total_views: 0,
          },
        });

        // Call gateway /begin
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

        const { requestId } = (await response.json()) as {
          requestId: string;
        };

        // Update shared article with warg request ID
        await articleRef.update({
          warg_request_id: requestId,
          status: 'processing',
          processing_started_at: Timestamp.now(),
        });

        // Mark user article as triggered
        await userDoc.ref.update({
          resolvedId: itemId,
          archival_triggered: true,
        });

        batchEntries.push({
          item_id: itemId,
          url,
          sent_at: Timestamp.now(),
          retry_count: newRetryCount,
        });

        successes++;
        console.log(
          `[backfill] [${i + 1}/${itemsToSend.length}] Triggered ${itemId}`
        );
      } catch (error) {
        failures++;
        const message =
          error instanceof Error ? error.message : String(error);
        console.error(
          `[backfill] [${i + 1}/${itemsToSend.length}] Failed ${itemId}: ${message}`
        );

        // Mark shared article as failed if it was created
        const articleRef = db.collection('articles').doc(itemId);
        const articleDoc = await articleRef.get();
        if (
          articleDoc.exists &&
          articleDoc.data()?.['status'] === 'pending'
        ) {
          await articleRef.update({
            status: 'failed',
            error: message,
            failed_at: Timestamp.now(),
          });
        }
      }

      // Stagger between calls (skip delay after last item)
      if (i < itemsToSend.length - 1) {
        await sleep(STAGGER_MS);
      }
    }

    console.log(
      `[backfill] Sent: ${successes} ok, ${failures} failed, ${skipped} skipped ` +
        `(${eligibleMap.size} total eligible)`
    );

    // Save tracker with new batch
    await trackerRef.set({
      ...tracker,
      batch: batchEntries,
      batch_started_at: batchEntries.length > 0 ? Timestamp.now() : null,
      batch_number: tracker.batch_number + 1,
      total_sent: tracker.total_sent + successes,
      last_run_at: Timestamp.now(),
      last_run_result: batchEntries.length > 0 ? 'sent_batch' : 'idle',
    });
  }
);

/**
 * HTTP endpoint: returns the current backfill tracker state.
 * Used by the dashboard to display backfill progress.
 */
export const backfillStatus = onRequest(
  { cors: true },
  async (req, res) => {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const apiKey = req.headers['x-internal-api-key'];
    if (!apiKey || apiKey !== INTERNAL_API_KEY.value()) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const db = getFirestore();
    const trackerSnap = await db.doc(TRACKER_DOC_PATH).get();

    if (!trackerSnap.exists) {
      res.json({ status: 'not_initialized', tracker: null });
      return;
    }

    res.json({ status: 'ok', tracker: trackerSnap.data() });
  }
);
