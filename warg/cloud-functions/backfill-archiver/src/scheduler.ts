import { randomUUID } from 'node:crypto';
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore';
import type {
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { buildPocket } from './canonical.js';
import {
  resolveCanonicalCandidates,
  type CanonicalCandidate,
} from './canonical-candidates.js';
import { classifyItem, getRetryCount } from './eligibility.js';
import {
  createDefaultRunSummary,
  isDomainBackedOff,
  normalizeTracker,
  enqueueRetry,
  pruneExpiredDomainBackoff,
  recordDomainFailure,
  recordDomainSuccess,
  shouldPauseGlobally,
  takeDueRetries,
} from './tracker.js';
import type {
  BackfillTracker,
  BatchEntry,
  BatchSettlement,
  ChangeMarker,
  FailureClass,
} from './types.js';

// The scheduled backfill run. The entry file builds the real dependencies and
// calls runBackfill; tests pass a Firestore fake, a clock and a begin stub.

/** The /begin request body the backfill sends for one shared article. */
export interface BeginPayload {
  url: string;
  request_id: string;
  includeScreenshot: boolean;
  includePdf: boolean;
}

export interface BackfillDeps {
  db: Firestore;
  userId: string;
  batchSize: number;
  scanPageSize: number;
  passLabel: string;
  beginArchive: (payload: BeginPayload) => Promise<{ requestId?: string; request_id?: string }>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  runOwner?: string;
}

const STAGGER_MS = 4000;
export const TRACKER_DOC_PATH = 'backfill_state/tracker';
const MAX_RETRIES = 2;
// Workstream C3: backstop above the observed ~43-min wall-clock tail so a job
// that will still finalize isn't called "stuck" first. Keep in sync with
// article-status.ts STUCK_TIMEOUT_MS and scripts/reconcile-status.mjs.
const STUCK_TIMEOUT_MS = 45 * 60 * 1000;

const DOMAIN_FAILURE_THRESHOLD = 2;
const DOMAIN_BACKOFF_MS = 30 * 60 * 1000;
const GLOBAL_PAUSE_MS = 20 * 60 * 1000;
const LEASE_TTL_MS = 15 * 60 * 1000;

// After a full pass the change scan starts this long before the pass began, so
// a change made during the pass, or stamped by a phone with a slow clock, is
// still read once.
export const CHANGE_MARKER_MARGIN_MS = 10 * 60 * 1000;
// Failed archive starts are retried from a list in the tracker, not by rescans.
export const RETRY_DELAY_MS = 10 * 60 * 1000;
export const RETRY_QUEUE_MAX = 200;

// Per-class retry backoff schedule. Index by retry_count (0, 1, 2+).
// WORKFLOW_TRIGGER: 10m → 1h → 4h (Cloudflare workflow ID collisions are
// transient and usually clear within an hour).
const WORKFLOW_TRIGGER_BACKOFF_MS = [
  10 * 60 * 1000,
  60 * 60 * 1000,
  4 * 60 * 60 * 1000,
];

function failureBackoffUntil(
  failure: Record<string, unknown> | null,
  retryCount: number
): number | null {
  if (!failure) return null;
  const cls = failure['class'];
  const lastSeenAt = failure['last_seen_at'];
  const lastSeenMs =
    lastSeenAt && typeof lastSeenAt === 'object' &&
    typeof (lastSeenAt as { toMillis?: unknown }).toMillis === 'function'
      ? (lastSeenAt as { toMillis: () => number }).toMillis()
      : null;
  if (lastSeenMs === null) return null;

  if (cls === 'WORKFLOW_TRIGGER') {
    const idx = Math.min(retryCount, WORKFLOW_TRIGGER_BACKOFF_MS.length - 1);
    const backoff = WORKFLOW_TRIGGER_BACKOFF_MS[idx] ?? 0;
    return lastSeenMs + backoff;
  }
  return null;
}

function isClassPermanentlyAbandoned(
  failure: Record<string, unknown> | null
): boolean {
  if (!failure) return false;
  const cls = failure['class'];
  return cls === 'DATA_ISSUE' || cls === 'ACCESS_OR_AUTH';
}

interface EligibleCanonical {
  candidate: CanonicalCandidate;
  isNew: boolean;
  retryCount: number;
}

interface NonEligibleCanonical {
  candidate: CanonicalCandidate;
  markTriggered: boolean;
  /** Set when the item is held back by a backoff that ends at this time. */
  backoffUntil?: number;
  /** The shared article's retry count, for a backoff-held item. */
  retryCount?: number;
}

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function classifyGatewayFailure(message: string): FailureClass {
  const lower = message.toLowerCase();

  if (
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('cf-access') ||
    lower.includes('x-api-key') ||
    lower.includes('server misconfigured')
  ) {
    return 'ACCESS_OR_AUTH';
  }

  if (
    lower.includes('workflow trigger failed') ||
    lower.includes('instance already exists') ||
    lower.includes('instance.already_exists')
  ) {
    return 'WORKFLOW_TRIGGER';
  }

  if (
    lower.includes('invalid url') ||
    lower.includes('url is required') ||
    lower.includes('base_url contains invalid characters') ||
    // Workstream E1: short canonical ids (e.g. "54149", "0") fail the gateway
    // request_id validator with HTTP 400. That is a permanent data problem, not
    // a transient upstream blip — classify it so the row is abandoned, not
    // retried 2× before giving up.
    lower.includes('invalid request_id') ||
    lower.includes('request_id format')
  ) {
    return 'DATA_ISSUE';
  }

  return 'TRANSIENT_UPSTREAM';
}

async function acquireRunLease(
  db: Firestore,
  trackerRef: DocumentReference<DocumentData>,
  owner: string,
  now: () => number
): Promise<{ acquired: boolean; tracker: BackfillTracker }> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(trackerRef);
    const tracker = normalizeTracker(snap.exists ? snap.data() : undefined);
    const nowMs = now();

    if (
      tracker.run_lease &&
      tracker.run_lease.owner !== owner &&
      tracker.run_lease.expires_at.toMillis() > nowMs
    ) {
      return { acquired: false, tracker };
    }

    tracker.run_lease = {
      owner,
      expires_at: Timestamp.fromMillis(nowMs + LEASE_TTL_MS),
    };
    tracker.last_run_at = Timestamp.fromMillis(now());
    tx.set(trackerRef, tracker);

    return { acquired: true, tracker };
  });
}

async function saveTrackerWithLease(
  db: Firestore,
  trackerRef: DocumentReference<DocumentData>,
  tracker: BackfillTracker,
  owner: string,
  now: () => number
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(trackerRef);
    const current = normalizeTracker(snap.exists ? snap.data() : undefined);
    const nowMs = now();

    if (
      current.run_lease &&
      current.run_lease.owner !== owner &&
      current.run_lease.expires_at.toMillis() > nowMs
    ) {
      throw new Error(`Backfill lease ownership changed to ${current.run_lease.owner}`);
    }

    tracker.run_lease = {
      owner,
      expires_at: Timestamp.fromMillis(nowMs + LEASE_TTL_MS),
    };
    tracker.last_run_at = Timestamp.fromMillis(now());
    tx.set(trackerRef, tracker);
  });
}

async function releaseRunLease(
  db: Firestore,
  trackerRef: DocumentReference<DocumentData>,
  owner: string,
  now: () => number
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(trackerRef);
    const tracker = normalizeTracker(snap.exists ? snap.data() : undefined);
    if (tracker.run_lease?.owner !== owner) {
      return;
    }

    tracker.run_lease = null;
    tracker.last_run_at = Timestamp.fromMillis(now());
    tx.set(trackerRef, tracker);
  });
}

async function fetchArticleSnapshotsById(
  db: Firestore,
  ids: string[]
): Promise<Map<string, DocumentSnapshot<DocumentData>>> {
  const byId = new Map<string, DocumentSnapshot<DocumentData>>();
  const chunkSize = 500;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const refs = chunk.map((id) => db.collection('articles').doc(id));
    const snapshots = await db.getAll(...refs);
    for (const snapshot of snapshots) {
      byId.set(snapshot.id, snapshot);
    }
  }

  return byId;
}

async function checkBatchSettlement(
  db: Firestore,
  batch: BatchEntry[],
  nowMs: number
): Promise<BatchSettlement> {
  const refs = batch.map((entry) => db.collection('articles').doc(entry.item_id));
  const snapshots = await db.getAll(...refs);

  const result: BatchSettlement = {
    complete: 0,
    failed: 0,
    stuck: 0,
    inProgress: 0,
    stuckIds: [],
    completeEntries: [],
    failedEntries: [],
    stuckEntries: [],
  };

  for (let i = 0; i < snapshots.length; i += 1) {
    const snapshot = snapshots[i]!;
    const entry = batch[i]!;
    const classification = classifyItem(
      snapshot.exists ? snapshot.data() : undefined,
      nowMs,
      STUCK_TIMEOUT_MS
    );

    switch (classification) {
      case 'complete':
        result.complete += 1;
        result.completeEntries.push(entry);
        break;
      case 'failed':
        result.failed += 1;
        result.failedEntries.push(entry);
        break;
      case 'stuck':
        result.stuck += 1;
        result.stuckIds.push(snapshot.id);
        result.stuckEntries.push(entry);
        break;
      case 'in_progress':
        result.inProgress += 1;
        break;
    }
  }

  return result;
}

async function markStuckAsFailed(
  db: Firestore,
  ids: string[],
  nowMs: number
): Promise<void> {
  const now = Timestamp.fromMillis(nowMs);
  const settlement = {
    status: 'stuck',
    error: 'Stuck: no completion after 30 minutes',
    created_at: now.toDate().toISOString(),
  };
  for (const id of ids) {
    // Status is derived by articleStatusDerive; persist the settlement
    // event under archives.workflow_settlement so the derivation has signal.
    await db.collection('articles').doc(id).set(
      {
        archives: { workflow_settlement: settlement },
        error: settlement.error,
        failed_at: now,
        updated_at: now,
      },
      { merge: true }
    );
  }
}

async function fetchUserArticlesPage(
  db: Firestore,
  userId: string,
  cursor: string | null,
  pageSize: number
): Promise<{
  docs: Array<QueryDocumentSnapshot<DocumentData>>;
  nextCursor: string | null;
  exhausted: boolean;
}> {
  const collection = db.collection('users').doc(userId).collection('articles');
  const pageQuery = collection
    .orderBy(FieldPath.documentId())
    .limit(pageSize);

  const snapshot = cursor
    ? await pageQuery.startAfter(cursor).get()
    : await pageQuery.get();

  if (!snapshot.empty) {
    const nextCursor = snapshot.docs[snapshot.docs.length - 1]!.id;
    return {
      docs: snapshot.docs,
      nextCursor,
      exhausted: snapshot.docs.length < pageSize,
    };
  }

  // End of the collection: the full pass is over. There is no wrap-around.
  return { docs: [], nextCursor: null, exhausted: true };
}

/**
 * The change scan: user articles whose app-written timeUpdated is at or after
 * the marker, in (timeUpdated, id) order, starting after the marker's article.
 */
async function fetchChangedUserArticles(
  db: Firestore,
  userId: string,
  marker: ChangeMarker,
  pageSize: number
): Promise<{
  docs: Array<QueryDocumentSnapshot<DocumentData>>;
  nextCursor: string | null;
  exhausted: boolean;
}> {
  const ordered = db
    .collection('users')
    .doc(userId)
    .collection('articles')
    .where('timeUpdated', '>=', marker.time_updated)
    .orderBy('timeUpdated')
    .orderBy(FieldPath.documentId());
  // The first marker after a pass has no article id. An empty id is not a valid
  // document-id cursor (source: node_modules/@google-cloud/firestore/build/src/reference/query.js
  // validateReference), and the where filter already starts the scan at the marker time.
  const page = marker.item_id
    ? ordered.startAfter(marker.time_updated, marker.item_id)
    : ordered;
  const snapshot = await page.limit(pageSize).get();
  const last = snapshot.docs[snapshot.docs.length - 1];
  return {
    docs: snapshot.docs,
    nextCursor: last ? last.id : null,
    exhausted: snapshot.docs.length < pageSize,
  };
}

function markerOf(
  doc: QueryDocumentSnapshot<DocumentData>,
  fallbackTime: number
): ChangeMarker {
  const timeUpdated: unknown = doc.data()['timeUpdated'];
  return {
    time_updated:
      typeof timeUpdated === 'number' && Number.isFinite(timeUpdated)
        ? timeUpdated
        : fallbackTime,
    item_id: doc.id,
  };
}

/**
 * Index of the last user article the run fully handled: the one before the
 * first article whose shared article was eligible but not sent this run, or
 * the last index when every eligible one was sent. -1 means none was handled.
 */
function handledPrefix(
  docs: Array<QueryDocumentSnapshot<DocumentData>>,
  candidates: CanonicalCandidate[],
  sentIds: Set<string>,
  eligibleIds: Set<string>
): number {
  const sharedIdByPath = new Map<string, string>();
  for (const candidate of candidates) {
    for (const ref of candidate.sourceUserRefs) {
      sharedIdByPath.set(ref.path, candidate.canonicalItemId);
    }
  }
  for (let i = 0; i < docs.length; i += 1) {
    const sharedId = sharedIdByPath.get(docs[i]!.ref.path);
    if (sharedId !== undefined && eligibleIds.has(sharedId) && !sentIds.has(sharedId)) {
      return i - 1;
    }
  }
  return docs.length - 1;
}

async function selectEligibleCanonicals(
  db: Firestore,
  candidates: CanonicalCandidate[],
  tracker: BackfillTracker,
  nowMs: number
): Promise<{
  eligible: EligibleCanonical[];
  nonEligible: NonEligibleCanonical[];
  unlinked: CanonicalCandidate[];
  skippedBackoff: number;
}> {
  const eligible: EligibleCanonical[] = [];
  const nonEligible: NonEligibleCanonical[] = [];
  const unlinked: CanonicalCandidate[] = [];
  let skippedBackoff = 0;

  if (candidates.length === 0) {
    return { eligible, nonEligible, unlinked, skippedBackoff };
  }

  const snapshotsById = await fetchArticleSnapshotsById(
    db,
    candidates.map((candidate) => candidate.canonicalItemId)
  );

  for (const candidate of candidates) {
    const snapshot = snapshotsById.get(candidate.canonicalItemId);
    if (isDomainBackedOff(tracker, candidate.domain, nowMs)) {
      skippedBackoff += 1;
      // An unlinked candidate (no server link, no shared article) is not held
      // for a retry: a retry would create a shared article the server did not choose.
      const exists = Boolean(snapshot?.exists);
      nonEligible.push(
        candidate.fromServerLink || exists
          ? {
              candidate,
              markTriggered: false,
              backoffUntil:
                tracker.domain_backoff[candidate.domain]?.backoff_until?.toMillis() ?? nowMs,
              retryCount: exists ? getRetryCount(snapshot!.data()) : 0,
            }
          : { candidate, markTriggered: false }
      );
      continue;
    }

    if (!snapshot || !snapshot.exists) {
      // The backfill creates a shared article only for a link the server chose.
      // An unlinked one waits for the save trigger or the link re-derive pass.
      if (!candidate.fromServerLink) {
        unlinked.push(candidate);
        continue;
      }
      eligible.push({ candidate, isNew: true, retryCount: 0 });
      continue;
    }

    const doc = snapshot.data();
    const retryCount = getRetryCount(doc);
    const classification = classifyItem(doc, nowMs, STUCK_TIMEOUT_MS);
    const failure =
      doc && typeof doc['failure'] === 'object' && doc['failure'] !== null
        ? (doc['failure'] as Record<string, unknown>)
        : null;

    if (
      (classification === 'failed' || classification === 'stuck') &&
      retryCount < MAX_RETRIES &&
      !isClassPermanentlyAbandoned(failure)
    ) {
      const backoffUntil = failureBackoffUntil(failure, retryCount);
      if (backoffUntil !== null && backoffUntil > nowMs) {
        // Within per-class backoff window — skip this run, retry later.
        nonEligible.push({ candidate, markTriggered: false, backoffUntil, retryCount });
        continue;
      }
      eligible.push({ candidate, isNew: false, retryCount });
    } else {
      const markTriggered = classification === 'complete' || classification === 'in_progress';
      nonEligible.push({ candidate, markTriggered });
    }
  }

  return { eligible, nonEligible, unlinked, skippedBackoff };
}

interface UpsertResult {
  articleRef: DocumentReference<DocumentData>;
  hadFirstSeenFailure: boolean;
}

async function upsertArticleBeforeBegin(
  db: Firestore,
  candidate: CanonicalCandidate,
  retryCount: number,
  nowMs: number
): Promise<UpsertResult> {
  const articleRef = db.collection('articles').doc(candidate.canonicalItemId);
  const existing = await articleRef.get();
  const existingData = existing.exists ? existing.data() : undefined;
  const existingFailure =
    existingData && typeof existingData['failure'] === 'object'
      ? (existingData['failure'] as Record<string, unknown>)
      : null;
  const hadFirstSeenFailure = Boolean(existingFailure?.['first_seen_at']);
  const now = Timestamp.fromMillis(nowMs);

  // status is derived by articleStatusDerive — don't write it here.
  const patch: Record<string, unknown> = {
    item_id: candidate.canonicalItemId,
    url: candidate.url,
    domain: candidate.domain,
    retry_count: retryCount,
    updated_at: now,
  };

  if (!existing.exists) {
    patch['created_at'] = now;
    patch['archives'] = {};
    patch['pocket'] = buildPocket(candidate.primaryUserData, candidate.canonicalItemId);
    patch['stats'] = {
      last_accessed: '',
      total_saves: 1,
      total_views: 0,
    };
  } else {
    const doc = existing.data();
    if (!doc?.['created_at']) patch['created_at'] = now;
    if (!doc?.['pocket']) {
      patch['pocket'] = buildPocket(candidate.primaryUserData, candidate.canonicalItemId);
    }
    if (!doc?.['stats']) {
      patch['stats'] = {
        last_accessed: '',
        total_saves: 1,
        total_views: 0,
      };
    }
  }

  await articleRef.set(patch, { merge: true });
  return { articleRef, hadFirstSeenFailure };
}

async function linkSourceUserDocs(
  candidate: CanonicalCandidate,
  markTriggered: boolean
): Promise<void> {
  for (const ref of candidate.sourceUserRefs) {
    const patch: Record<string, unknown> = {
      resolvedId: candidate.canonicalItemId,
    };
    if (markTriggered) {
      patch['archival_triggered'] = true;
    }
    await ref.set(patch, { merge: true });
  }
}

export async function runBackfill(deps: BackfillDeps): Promise<void> {
  const { db, userId, batchSize, scanPageSize, beginArchive } = deps;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? realSleep;
  const trackerRef = db.doc(TRACKER_DOC_PATH);
  const runOwner = deps.runOwner ?? `backfill-${randomUUID()}`;
  const queueRetry = (
    tracker: BackfillTracker,
    entry: { item_id: string; url: string; domain: string; retry_count: number }
  ): void => {
    const dropped = enqueueRetry(
      tracker,
      {
        item_id: entry.item_id,
        url: entry.url,
        domain: entry.domain,
        retry_count: entry.retry_count,
        not_before: Timestamp.fromMillis(now() + RETRY_DELAY_MS),
      },
      RETRY_QUEUE_MAX
    );
    if (dropped) {
      console.warn(`[backfill] run=${runOwner} retry list full; dropped the oldest entry`);
    }
  };
  console.log(
    `[backfill] run=${runOwner} starting (batchSize=${batchSize}, scanPageSize=${scanPageSize})`
  );

  const { acquired, tracker: loadedTracker } = await acquireRunLease(
    db,
    trackerRef,
    runOwner,
    now
  );

  if (!acquired) {
    console.log(`[backfill] run=${runOwner} another run owns lease, skipping`);
    return;
  }

  const tracker = loadedTracker;

  try {
    pruneExpiredDomainBackoff(tracker, now());

    if (
      tracker.paused &&
      tracker.global_pause_until &&
      tracker.global_pause_until.toMillis() > now()
    ) {
      console.log(
        `[backfill] run=${runOwner} globally paused until ${tracker.global_pause_until.toDate().toISOString()}`
      );
      tracker.last_run_result = 'backoff';
      tracker.last_run_summary = createDefaultRunSummary();
      await saveTrackerWithLease(db, trackerRef, tracker, runOwner, now);
      return;
    }

    if (
      tracker.paused &&
      (!tracker.global_pause_until ||
        tracker.global_pause_until.toMillis() <= now())
    ) {
      tracker.paused = false;
      tracker.global_pause_until = null;
      tracker.pause_reason = null;
    }

    if (tracker.batch.length > 0) {
      console.log(
        `[backfill] run=${runOwner} checking active batch #${tracker.batch_number} (${tracker.batch.length} items)`
      );
      const settlement = await checkBatchSettlement(db, tracker.batch, now());

      if (settlement.stuckIds.length > 0) {
        console.warn(
          `[backfill] run=${runOwner} marking ${settlement.stuckIds.length} stuck items as failed`
        );
        await markStuckAsFailed(db, settlement.stuckIds, now());
      }

      if (settlement.inProgress > 0) {
        console.log(
          `[backfill] run=${runOwner} waiting on ${settlement.inProgress} in-progress items`
        );
        tracker.last_run_result = 'waiting';
        tracker.last_run_summary = {
          considered: tracker.batch.length,
          eligible: 0,
          triggered: 0,
          linked_only: 0,
          skipped_backoff: 0,
          failed: settlement.failed + settlement.stuck,
        };
        await saveTrackerWithLease(db, trackerRef, tracker, runOwner, now);
        return;
      }

      const nowMs = now();
      for (const entry of settlement.completeEntries) {
        recordDomainSuccess(tracker, entry.domain);
      }
      for (const entry of [...settlement.failedEntries, ...settlement.stuckEntries]) {
        recordDomainFailure(
          tracker,
          entry.domain,
          nowMs,
          DOMAIN_FAILURE_THRESHOLD,
          DOMAIN_BACKOFF_MS,
          'batch settlement failure'
        );
        if (entry.retry_count < MAX_RETRIES) {
          queueRetry(tracker, entry);
        }
      }

      tracker.total_completed += settlement.complete;
      tracker.total_failed += settlement.failed + settlement.stuck;
      tracker.batch = [];
      tracker.batch_started_at = null;
      tracker.consecutive_all_failed = 0;
      tracker.last_run_result = 'settled';
      tracker.last_run_summary = {
        considered:
          settlement.complete +
          settlement.failed +
          settlement.stuck +
          settlement.inProgress,
        eligible: 0,
        triggered: 0,
        linked_only: 0,
        skipped_backoff: 0,
        failed: settlement.failed + settlement.stuck,
      };

      await saveTrackerWithLease(db, trackerRef, tracker, runOwner, now);
      console.log(
        `[backfill] run=${runOwner} batch settled complete=${settlement.complete} failed=${settlement.failed} stuck=${settlement.stuck}`
      );

      if (settlement.complete === 0 && settlement.failed + settlement.stuck > 0) {
        console.log(
          `[backfill] run=${runOwner} all items failed/stuck; deferring retries to next cycle`
        );
        return;
      }
    }

    // One full pass per pass label, then only articles changed since the marker.
    if (tracker.pass_label !== deps.passLabel || !tracker.pass_started_at) {
      tracker.pass_label = deps.passLabel;
      tracker.pass_started_at = Timestamp.fromMillis(now());
      tracker.pass_completed_at = null;
      tracker.scan_cursor = null;
      tracker.scan_exhausted = false;
      console.log(`[backfill] run=${runOwner} starting a new full pass`);
    }
    const passStartedMs = tracker.pass_started_at.toMillis();
    const dueRetries = tracker.pass_completed_at
      ? takeDueRetries(tracker, now(), batchSize)
      : [];
    const mode: 'full_pass' | 'retry' | 'changes' = !tracker.pass_completed_at
      ? 'full_pass'
      : dueRetries.length > 0
        ? 'retry'
        : 'changes';
    const marker: ChangeMarker = tracker.change_marker ?? {
      time_updated: passStartedMs - CHANGE_MARKER_MARGIN_MS,
      item_id: '',
    };

    // A retry run reads no user articles and leaves the cursor and marker alone.
    const page =
      mode === 'full_pass'
        ? await fetchUserArticlesPage(db, userId, tracker.scan_cursor, scanPageSize)
        : mode === 'changes'
          ? await fetchChangedUserArticles(db, userId, marker, scanPageSize)
          : { docs: [], nextCursor: null, exhausted: true };
    const userArticles = page.docs;

    // Moves the cursor (full pass) or the marker (change scan) past the handled
    // prefix of this page. A pass completes only when the page was the last one
    // and nothing eligible was left unsent.
    const advancePosition = (handledIdx: number): void => {
      if (mode === 'retry') return;
      const cutoff = handledIdx < userArticles.length - 1;
      const handledDoc = handledIdx >= 0 ? userArticles[handledIdx] : undefined;
      if (mode === 'changes') {
        if (handledDoc) tracker.change_marker = markerOf(handledDoc, marker.time_updated);
        return;
      }
      if (!cutoff && page.exhausted) {
        tracker.pass_completed_at = Timestamp.fromMillis(now());
        tracker.change_marker = {
          time_updated: passStartedMs - CHANGE_MARKER_MARGIN_MS,
          item_id: '',
        };
        tracker.scan_cursor = null;
        tracker.scan_exhausted = true;
        console.log(`[backfill] run=${runOwner} full pass complete`);
        return;
      }
      if (handledDoc) tracker.scan_cursor = handledDoc.id;
      tracker.scan_exhausted = false;
    };

    const runSummary = createDefaultRunSummary();
    runSummary.considered = userArticles.length;

    if (mode !== 'retry' && userArticles.length === 0) {
      console.log(
        `[backfill] run=${runOwner} mode=${mode} no ${mode === 'changes' ? 'changed ' : ''}user articles`
      );
      advancePosition(-1);
      tracker.last_run_result = 'idle';
      tracker.last_run_summary = runSummary;
      await saveTrackerWithLease(db, trackerRef, tracker, runOwner, now);
      return;
    }

    const candidates: CanonicalCandidate[] =
      mode === 'retry'
        ? dueRetries.map((entry) => ({
            canonicalItemId: entry.item_id,
            url: entry.url,
            domain: entry.domain,
            sourceUserRefs: [],
            primaryUserData: {},
            fromServerLink: true,
          }))
        : await resolveCanonicalCandidates(db, userArticles);
    const { eligible, nonEligible, unlinked, skippedBackoff } =
      await selectEligibleCanonicals(db, candidates, tracker, now());

    if (mode === 'retry') {
      runSummary.considered = candidates.length;
      // An entry held back by a backoff waits until the backoff ends; one that
      // is complete, in progress, abandoned or out of retries leaves the list.
      // Entries about to be sent leave it too; a failed send queues them again.
      const held = new Map<string, number>();
      for (const item of nonEligible) {
        if (item.backoffUntil !== undefined) {
          held.set(item.candidate.canonicalItemId, item.backoffUntil);
        }
      }
      tracker.retry_queue = tracker.retry_queue.flatMap((entry) => {
        const until = held.get(entry.item_id);
        if (until !== undefined) {
          return [{ ...entry, not_before: Timestamp.fromMillis(Math.max(until, now())) }];
        }
        const due = candidates.some((c) => c.canonicalItemId === entry.item_id);
        return due ? [] : [entry];
      });
    }

    runSummary.eligible = eligible.length;
    runSummary.skipped_backoff = skippedBackoff;
    console.log(
      `[backfill] run=${runOwner} mode=${mode} pageDocs=${userArticles.length} candidates=${candidates.length} eligible=${eligible.length} unlinked=${unlinked.length} skippedBackoff=${skippedBackoff} cursor=${tracker.scan_cursor ?? 'null'} next=${page.nextCursor ?? 'null'} exhausted=${page.exhausted}`
    );

    for (const item of nonEligible) {
      await linkSourceUserDocs(item.candidate, item.markTriggered);
      if (item.markTriggered) {
        runSummary.linked_only += item.candidate.sourceUserRefs.length;
      }
    }

    // The scan moves past this page, and a backoff's end changes neither the
    // user article nor the scan position, so an item held back only by a
    // domain or per-class backoff goes on the retry list, due when it ends.
    if (mode !== 'retry') {
      for (const item of nonEligible) {
        if (item.backoffUntil === undefined) continue;
        const dropped = enqueueRetry(
          tracker,
          {
            item_id: item.candidate.canonicalItemId,
            url: item.candidate.url,
            domain: item.candidate.domain,
            retry_count: item.retryCount ?? 0,
            not_before: Timestamp.fromMillis(Math.max(item.backoffUntil, now())),
          },
          RETRY_QUEUE_MAX
        );
        if (dropped) {
          console.warn(`[backfill] run=${runOwner} retry list full; dropped the oldest entry`);
        }
      }
    }

    if (eligible.length === 0) {
      console.log(`[backfill] run=${runOwner} mode=${mode} no eligible items to start`);
      advancePosition(userArticles.length - 1);
      tracker.last_run_result = runSummary.skipped_backoff > 0 ? 'backoff' : 'idle';
      tracker.last_run_summary = runSummary;
      await saveTrackerWithLease(db, trackerRef, tracker, runOwner, now);
      return;
    }

    const itemsToSend = eligible.slice(0, batchSize);
    const batchEntries: BatchEntry[] = [];
    let successes = 0;
    const failuresByClass: Record<FailureClass, number> = {
      ACCESS_OR_AUTH: 0,
      WORKFLOW_TRIGGER: 0,
      TRANSIENT_UPSTREAM: 0,
      DATA_ISSUE: 0,
    };

    for (let i = 0; i < itemsToSend.length; i += 1) {
      const item = itemsToSend[i]!;
      const retryCount = item.isNew ? 0 : item.retryCount + 1;
      const { articleRef, hadFirstSeenFailure } = await upsertArticleBeforeBegin(
        db,
        item.candidate,
        retryCount,
        now()
      );

      try {
        // request_id is the shared article id, so a re-submission reuses it.
        const beginResponse = await beginArchive({
          url: item.candidate.url,
          request_id: item.candidate.canonicalItemId,
          includeScreenshot: true,
          includePdf: true,
        });

        const requestId = beginResponse.requestId ?? beginResponse.request_id;
        if (!requestId) {
          throw new Error('Gateway begin returned no request id');
        }

        // status is derived by articleStatusDerive; processing_started_at
        // is the signal the trigger uses to compute `processing`.
        await articleRef.set(
          {
            warg_request_id: requestId,
            processing_started_at: Timestamp.fromMillis(now()),
            updated_at: Timestamp.fromMillis(now()),
            error: FieldValue.delete(),
          },
          { merge: true }
        );

        await linkSourceUserDocs(item.candidate, true);
        console.log(
          `[backfill] run=${runOwner} triggered canonicalId=${item.candidate.canonicalItemId} domain=${item.candidate.domain} retry=${retryCount}`
        );

        batchEntries.push({
          item_id: item.candidate.canonicalItemId,
          url: item.candidate.url,
          domain: item.candidate.domain,
          sent_at: Timestamp.fromMillis(now()),
          retry_count: retryCount,
        });

        successes += 1;
        runSummary.triggered += 1;
        recordDomainSuccess(tracker, item.candidate.domain);
      } catch (error) {
        const message = errorMessage(error);
        const failureClass = classifyGatewayFailure(message);
        failuresByClass[failureClass] += 1;
        runSummary.failed += 1;
        console.error(
          `[backfill] run=${runOwner} failed canonicalId=${item.candidate.canonicalItemId} domain=${item.candidate.domain} class=${failureClass}: ${message}`
        );

        // status is derived by articleStatusDerive. Persist the failure
        // class + a gateway_begin archive entry so the trigger can
        // distinguish ACCESS_OR_AUTH (no retry) / DATA_ISSUE (abandoned)
        // / WORKFLOW_TRIGGER / TRANSIENT_UPSTREAM.
        const failedAt = Timestamp.fromMillis(now());
        const failurePatch: Record<string, unknown> = {
          class: failureClass,
          last_seen_at: failedAt,
          count: FieldValue.increment(1),
          last_error_message: message,
        };
        if (!hadFirstSeenFailure) {
          failurePatch['first_seen_at'] = failedAt;
        }
        await articleRef.set(
          {
            archives: {
              gateway_begin: {
                status: 'failed',
                error: message,
                created_at: failedAt.toDate().toISOString(),
              },
            },
            failure: failurePatch,
            error: message,
            failed_at: failedAt,
            retry_count: retryCount,
            updated_at: failedAt,
          },
          { merge: true }
        );

        await linkSourceUserDocs(item.candidate, false);

        recordDomainFailure(
          tracker,
          item.candidate.domain,
          now(),
          DOMAIN_FAILURE_THRESHOLD,
          DOMAIN_BACKOFF_MS,
          message
        );

        if (
          failureClass !== 'ACCESS_OR_AUTH' &&
          failureClass !== 'DATA_ISSUE' &&
          retryCount < MAX_RETRIES
        ) {
          queueRetry(tracker, {
            item_id: item.candidate.canonicalItemId,
            url: item.candidate.url,
            domain: item.candidate.domain,
            retry_count: retryCount,
          });
        }
      }

      if (i < itemsToSend.length - 1) {
        await sleep(STAGGER_MS);
      }
    }

    tracker.batch = batchEntries;
    tracker.batch_started_at = batchEntries.length > 0 ? Timestamp.fromMillis(now()) : null;
    // Eligible items beyond one batch stay ahead of the cursor or marker, so the
    // next run reads them again instead of skipping them.
    advancePosition(
      handledPrefix(
        userArticles,
        candidates,
        new Set(itemsToSend.map((item) => item.candidate.canonicalItemId)),
        new Set(eligible.map((item) => item.candidate.canonicalItemId))
      )
    );
    if (batchEntries.length > 0) {
      tracker.batch_number += 1;
    }
    tracker.total_sent += successes;
    tracker.last_run_summary = runSummary;
    tracker.last_run_result =
      batchEntries.length > 0
        ? 'sent_batch'
        : runSummary.skipped_backoff > 0 || runSummary.failed > 0
        ? 'backoff'
        : 'idle';

    if (
      shouldPauseGlobally(failuresByClass, runSummary.failed) &&
      runSummary.triggered === 0
    ) {
      tracker.paused = true;
      tracker.pause_reason = 'auth_or_access';
      tracker.global_pause_until = Timestamp.fromMillis(now() + GLOBAL_PAUSE_MS);
      tracker.last_run_result = 'backoff';
      console.error(
        `[backfill] run=${runOwner} entering global pause (${GLOBAL_PAUSE_MS / 60000}m) due to auth/access failures`
      );
    }

    await saveTrackerWithLease(db, trackerRef, tracker, runOwner, now);
    console.log(
      `[backfill] run=${runOwner} mode=${mode} completed result=${tracker.last_run_result} summary=${JSON.stringify(runSummary)}`
    );
  } finally {
    try {
      await releaseRunLease(db, trackerRef, runOwner, now);
    } catch (error) {
      console.error(`[backfill] Failed to release run lease: ${errorMessage(error)}`);
    }
  }
}
