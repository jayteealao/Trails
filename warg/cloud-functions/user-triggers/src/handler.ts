import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { InvalidSharedIdError, SharedIdConflictError, isValidSharedId, linkUserArticle } from './link.js';

/** Starts the archive of a shared article (the gateway /begin call). */
export interface BeginArchive {
  (payload: { url: string; request_id: string; includeScreenshot: boolean; includePdf: boolean }): Promise<{
    requestId?: string;
    request_id?: string;
  }>;
}

/**
 * How long a failed save keeps being retried. The trigger is deployed with
 * retry on, so a thrown error re-delivers the event with backoff; after this
 * window the handler records the failure instead of throwing again.
 */
export const RETRY_WINDOW_MS = 60 * 60 * 1000;

/** True while an event of this age should still be retried by throwing. */
export function withinRetryWindow(eventTimeMs: number | undefined, nowMs: number): boolean {
  return eventTimeMs !== undefined && Number.isFinite(eventTimeMs) && nowMs - eventTimeMs < RETRY_WINDOW_MS;
}

export type HandleResult = 'missing-url' | 'invalid-id' | 'conflict' | 'linked' | 'created' | 'already-linked' | 'error';

/**
 * Handles a new users/{userId}/articles/{itemId} document: links it to its
 * shared article, then starts the archive when this article created the shared
 * article and the archive has not started yet. The archive start runs outside
 * the link transaction, so a transaction retry never repeats it, and a retried
 * event finishes a start that an earlier attempt did not reach.
 *
 * Log lines name the item id only, never the user id.
 */
export async function handleUserArticleCreated(
  input: {
    db: Firestore;
    userId: string;
    itemId: string;
    data: Record<string, unknown>;
    /** When the save event happened; set by the trigger so a failure inside the retry window throws. */
    eventTimeMs?: number;
  },
  deps: { beginArchive: BeginArchive; nowMs?: () => number }
): Promise<HandleResult> {
  const { db, userId, itemId, data } = input;
  const userRef = db.collection('users').doc(userId).collection('articles').doc(itemId);
  const articleRef = db.collection('articles').doc(itemId);

  console.log(`[onUserArticleSave] Processing ${itemId}`);

  const url = data['url'];
  if (!url) {
    console.error(`Missing URL for article ${itemId}`);
    await userRef.update({ error: 'Missing URL', error_at: Timestamp.now() });
    return 'missing-url';
  }

  if (!isValidSharedId(itemId)) {
    console.error(`[onUserArticleSave] Invalid article id ${JSON.stringify(itemId)}`);
    await userRef.update({ error: 'Invalid article id', error_at: Timestamp.now() });
    return 'invalid-id';
  }

  try {
    const pocket = {
      favorite: data['favorite'] ?? '',
      resolved_id: data['resolvedId'] ?? '',
      status: data['status'] ?? '',
      time_added: data['timeAdded'] ?? 0,
      time_read: data['timeRead'] ?? 0,
    };
    const outcome = await linkUserArticle(db, { userId, itemId, url: url as string, pocket });
    console.log(
      `[onUserArticleSave] ${itemId} linked to shared article ${outcome.canonicalId}` +
        ` (created: ${outcome.created}, already linked: ${outcome.alreadyLinked})`
    );

    if (outcome.needsArchive) {
      const begun = await deps.beginArchive({
        url: url as string,
        request_id: outcome.canonicalId,
        includeScreenshot: true,
        includePdf: true,
      });
      const requestId = begun.requestId ?? begun.request_id;
      console.log(`[onUserArticleSave] Warg archive started: ${requestId}`);

      await db.collection('articles').doc(outcome.canonicalId).update({
        warg_request_id: requestId,
        status: 'processing',
        processing_started_at: Timestamp.now(),
      });
      await userRef.update({ archival_triggered: true });
    }

    if (outcome.alreadyLinked) return 'already-linked';
    return outcome.created ? 'created' : 'linked';
  } catch (error) {
    if (error instanceof SharedIdConflictError) {
      console.error(`[onUserArticleSave] ${error.message}`);
      await userRef.update({ error: 'Shared article id conflict', error_at: Timestamp.now() });
      return 'conflict';
    }
    if (error instanceof InvalidSharedIdError) {
      await userRef.update({ error: 'Invalid article id', error_at: Timestamp.now() });
      return 'invalid-id';
    }

    console.error(`[onUserArticleSave] Error processing ${itemId}:`, error);
    const message = error instanceof Error ? error.message : String(error);

    // Inside the retry window, throw so the event is delivered again. The link
    // is idempotent (an existing canonicalId stops it) and a retried event
    // starts an archive that is still pending, so nothing is marked failed yet.
    if (withinRetryWindow(input.eventTimeMs, (deps.nowMs ?? Date.now)())) {
      console.error(`[onUserArticleSave] ${itemId} will be retried`);
      throw error;
    }

    // Mark the shared article this user article created as failed while it is still pending.
    const articleDoc = await articleRef.get();
    if (articleDoc.exists && articleDoc.data()?.['status'] === 'pending') {
      await articleRef.update({
        status: 'failed',
        error: message,
        failed_at: Timestamp.now(),
      });
    }

    await userRef.update({ error: message, error_at: Timestamp.now() });
    return 'error';
  }
}
