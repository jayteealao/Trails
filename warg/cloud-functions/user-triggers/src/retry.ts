import { Timestamp, type DocumentData, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  SHARED_ID_SHAPE,
  claimSharedArticleRetryInTransaction,
  deriveStatus,
  markSharedArticleArchiveStarted,
  mergedTargetOf,
  readCanonicalId,
  releaseSharedArticleRetryInTransaction,
} from '@warg/article-writer';
import { GatewayBeginError } from './gateway-client.js';
import type { BeginArchive } from './handler.js';

/**
 * The answer of a retry:
 *   started        the archive run was started
 *   in_flight      a run is already going; nothing was started
 *   complete       the archive is complete; nothing was started
 *   not_started    the save has not started its first run yet and still owns it
 *   not_retryable  another run cannot help (bad data, or no usable link)
 *   not_sent       the start was not sent: the gateway refused it, or the caller
 *                  started too many retries this hour; a later retry may work
 *   unconfirmed    the start may have happened; the article stays claimed until
 *                  the stuck timeout of the status rule passes
 */
export interface RetryAnswer {
  outcome: 'started' | 'in_flight' | 'complete' | 'not_started' | 'not_retryable' | 'not_sent' | 'unconfirmed';
  /**
   * Set with not_sent: the operator's own run owns the request id, the caller
   * reached the hourly limit of retries, or any other refusal of the gateway.
   */
  reason?: 'operator_owned' | 'rate_limited' | 'gateway';
}

/** A claimed start: what to send, and what a release needs. */
interface Claim {
  ref: DocumentReference;
  url: string;
  claimedAt: Timestamp;
  priorProcessingStartedAt: Timestamp | undefined;
}

/** The archive runs one person may start by retries in one window. */
export const RETRY_LIMIT = 10;
/** The window of the retry limit. */
export const RETRY_WINDOW_MS = 60 * 60 * 1000;

/**
 * The retries a person started in the current window. Kept in a collection the
 * security rules give no client access to, so the caller cannot reset it.
 */
function retryLimitRef(db: Firestore, userId: string): DocumentReference {
  return db.collection('retry_limits').doc(userId);
}

/** The count of the window that holds `now`, before this retry. */
function startsInWindow(data: DocumentData | undefined, now: number): { windowStart: Timestamp; count: number } {
  const start: unknown = data?.['window_start'];
  const count: unknown = data?.['count'];
  if (start instanceof Timestamp && typeof count === 'number' && now - start.toMillis() < RETRY_WINDOW_MS) {
    return { windowStart: start, count };
  }
  return { windowStart: Timestamp.fromMillis(now), count: 0 };
}

/** One message for every article the caller may not retry, so the answer reveals no id. */
function denied(): HttpsError {
  return new HttpsError('permission-denied', 'The article cannot be retried');
}

function startTimeOf(data: DocumentData): Timestamp | undefined {
  const value: unknown = data['processing_started_at'];
  return value instanceof Timestamp ? value : undefined;
}

function usableUrl(data: DocumentData): string | undefined {
  const url: unknown = data['url'];
  if (typeof url !== 'string' || !URL.canParse(url)) return undefined;
  return /^https?:$/.test(new URL(url).protocol) ? url : undefined;
}

/** The `code` of a gateway error body, undefined for a body the gateway did not write. */
function gatewayCode(body: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Not JSON, so not a gateway error body: the caller treats it as unknown.
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || !('code' in parsed)) return undefined;
  return typeof parsed.code === 'string' ? parsed.code : undefined;
}

/**
 * Whether the gateway itself refused the start. Any other answer (a server
 * error page of the network in between, the gateway's own INTERNAL_ERROR, which
 * also covers a call to the workflow that broke off after the run began, or a
 * success that names no run) leaves open whether a run exists.
 */
function isRefusal(error: unknown): error is GatewayBeginError {
  if (!(error instanceof GatewayBeginError)) return false;
  if (error.status >= 400 && error.status < 500) return true;
  const code = gatewayCode(error.body);
  return code !== undefined && code !== 'INTERNAL_ERROR';
}

/**
 * Reads the caller's article and its shared article and, when a run may start,
 * claims the start, all in one transaction: of two retries at the same time the
 * second one reads the claim of the first.
 */
async function claimRetry(
  db: Firestore,
  userId: string,
  itemId: string,
  nowMs: () => number
): Promise<RetryAnswer | Claim> {
  const articles = db.collection('articles');
  return db.runTransaction<RetryAnswer | Claim>(async (tx) => {
    const userSnap = await tx.get(db.collection('users').doc(userId).collection('articles').doc(itemId));
    const userDoc = userSnap.data();
    if (!userDoc || (userDoc['deletedAt'] ?? null) !== null || (userDoc['deleted_at'] ?? null) !== null) {
      throw denied();
    }
    // Only the server-written link names the shared article: the caller can
    // create a user article with any id and any url.
    const linkId = readCanonicalId(userDoc);
    if (linkId === undefined) throw denied();

    let shared = await tx.get(articles.doc(linkId));
    const target = mergedTargetOf(linkId, shared.data());
    if (target) {
      const winner = await tx.get(articles.doc(target));
      if (winner.exists) shared = winner;
    }
    const data = shared.data();
    if (!data) throw denied();
    // Read with the other reads: a transaction writes only after its last read.
    const limitRef = retryLimitRef(db, userId);
    const limitData = (await tx.get(limitRef)).data();

    const now = nowMs();
    const status = deriveStatus(data, now);
    const priorProcessingStartedAt = startTimeOf(data);
    if (status === 'complete') return { outcome: 'complete' };
    if (status === 'processing') return { outcome: 'in_flight' };
    if (status === 'pending' && !priorProcessingStartedAt) return { outcome: 'not_started' };
    const url = usableUrl(data);
    if (data['failure']?.class === 'DATA_ISSUE' || url === undefined) return { outcome: 'not_retryable' };

    // Only a start counts: an answer that starts nothing costs nothing.
    const window = startsInWindow(limitData, now);
    if (window.count >= RETRY_LIMIT) return { outcome: 'not_sent', reason: 'rate_limited' };
    tx.set(limitRef, { window_start: window.windowStart, count: window.count + 1 });

    const ref = articles.doc(shared.id);
    const claimedAt = Timestamp.fromMillis(now);
    claimSharedArticleRetryInTransaction(tx, ref, claimedAt);
    return { ref, url, claimedAt, priorProcessingStartedAt };
  });
}

/** Undoes the claim, unless a later start has replaced it. */
async function releaseClaim(db: Firestore, claim: Claim, error: string, nowMs: () => number): Promise<void> {
  await db.runTransaction(async (tx) => {
    const current = startTimeOf((await tx.get(claim.ref)).data() ?? {});
    if (!current?.isEqual(claim.claimedAt)) return;
    releaseSharedArticleRetryInTransaction(
      tx,
      claim.ref,
      { error, priorProcessingStartedAt: claim.priorProcessingStartedAt },
      Timestamp.fromMillis(nowMs())
    );
  });
}

/**
 * Archives an article the caller saved again, when its last run failed or died.
 * The gateway starts another run for a request id whose first run has ended, so
 * the claim is what keeps a second run from starting. `beginArchive` must make
 * one attempt for the same reason.
 *
 * Log lines name the item id only, never the user id.
 */
export async function handleArchiveRetry(
  input: { db: Firestore; userId: string; itemId: unknown },
  deps: { beginArchive: BeginArchive; nowMs?: () => number }
): Promise<RetryAnswer> {
  const { db, userId, itemId } = input;
  const nowMs = deps.nowMs ?? Date.now;
  if (typeof itemId !== 'string' || !SHARED_ID_SHAPE.test(itemId)) {
    throw new HttpsError('invalid-argument', 'itemId is not an article id');
  }

  const claim = await claimRetry(db, userId, itemId, nowMs);
  if ('outcome' in claim) {
    console.log(`[retryArchive] ${itemId}: ${claim.outcome}`);
    return claim;
  }

  let requestId: string | undefined;
  try {
    const begun = await deps.beginArchive({
      url: claim.url,
      request_id: claim.ref.id,
      includeScreenshot: true,
      includePdf: true,
    });
    requestId = begun.requestId ?? begun.request_id;
  } catch (error) {
    console.error(`[retryArchive] ${itemId}: the archive start failed:`, error);
    if (!isRefusal(error)) return { outcome: 'unconfirmed' };
    try {
      await releaseClaim(db, claim, `Archive retry refused: ${error.status}`, nowMs);
    } catch (releaseError) {
      // The claim stays, so the next retry reads in flight until the timeout.
      console.error(`[retryArchive] ${itemId}: could not release the claim:`, releaseError);
      return { outcome: 'unconfirmed' };
    }
    const owned = gatewayCode(error.body) === 'REQUEST_ID_CONFLICT';
    return { outcome: 'not_sent', reason: owned ? 'operator_owned' : 'gateway' };
  }

  console.log(`[retryArchive] ${itemId}: archive started: ${requestId}`);
  try {
    await markSharedArticleArchiveStarted(claim.ref, requestId);
  } catch (error) {
    // The run exists and the claim stays, so only its id is missing.
    console.error(`[retryArchive] ${itemId}: could not record the start:`, error);
  }
  return { outcome: 'started' };
}
