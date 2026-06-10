import { initializeApp, getApps } from 'firebase-admin/app';
import {
  FieldPath,
  FieldValue,
  getFirestore,
  Timestamp,
} from 'firebase-admin/firestore';
import type {
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { defineInt, defineSecret, defineString } from 'firebase-functions/params';
import { hasValidInternalApiKey } from './auth.js';
import { buildPocket, extractDomain, resolveCanonicalFromUserDoc } from './canonical.js';
import { classifyItem, getRetryCount } from './eligibility.js';
import { callGatewayBegin } from './gateway-client.js';
import {
  createDefaultRunSummary,
  isDomainBackedOff,
  normalizeTracker,
  pruneExpiredDomainBackoff,
  recordDomainFailure,
  recordDomainSuccess,
  shouldPauseGlobally,
} from './tracker.js';
import type {
  BackfillTracker,
  BatchEntry,
  BatchSettlement,
  FailureClass,
} from './types.js';

export { articleStatusDerive } from './article-status-trigger.js';

if (getApps().length === 0) {
  initializeApp();
}

const GATEWAY_URL = defineString('GATEWAY_URL', {
  default: 'https://gateway.jayteealao.workers.dev',
});
const PUBLIC_API_KEY = defineString('PUBLIC_API_KEY');
const INTERNAL_API_KEY = defineString('INTERNAL_API_KEY');
const CF_ACCESS_CLIENT_ID = defineSecret('CF_ACCESS_CLIENT_ID');
const CF_ACCESS_CLIENT_SECRET = defineSecret('CF_ACCESS_CLIENT_SECRET');
const BACKFILL_USER_ID = defineString('BACKFILL_USER_ID', {
  default: 'TGtRF6GrQaSmfjGk9GEYJ8YZc0v1',
});

// Workstream C1 (archive-completion-rootcause.md): smaller batches + longer
// stagger reduce BrowserQuotaDO contention so render/singlefile starts don't
// queue past the stuck timeout. 12 items × 4s stagger ≈ 48s, well under the
// 540s function budget.
const BATCH_SIZE = defineInt('BACKFILL_BATCH_SIZE', { default: 12 });
const SCAN_PAGE_SIZE = defineInt('BACKFILL_SCAN_PAGE_SIZE', { default: 250 });
const STAGGER_MS = 4000;
const TRACKER_DOC_PATH = 'backfill_state/tracker';
const MAX_RETRIES = 2;
// Workstream C3: backstop above the observed ~43-min wall-clock tail so a job
// that will still finalize isn't called "stuck" first. Keep in sync with
// article-status.ts STUCK_TIMEOUT_MS and scripts/reconcile-status.mjs.
const STUCK_TIMEOUT_MS = 45 * 60 * 1000;

const DOMAIN_FAILURE_THRESHOLD = 2;
const DOMAIN_BACKOFF_MS = 30 * 60 * 1000;
const GLOBAL_PAUSE_MS = 20 * 60 * 1000;
const LEASE_TTL_MS = 15 * 60 * 1000;

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

interface CanonicalCandidate {
  canonicalItemId: string;
  url: string;
  domain: string;
  sourceUserRefs: Array<DocumentReference<DocumentData>>;
  primaryUserData: DocumentData;
}

interface EligibleCanonical {
  candidate: CanonicalCandidate;
  isNew: boolean;
  retryCount: number;
}

interface NonEligibleCanonical {
  candidate: CanonicalCandidate;
  markTriggered: boolean;
}

function sleep(ms: number): Promise<void> {
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
  db: FirebaseFirestore.Firestore,
  trackerRef: DocumentReference<DocumentData>,
  owner: string
): Promise<{ acquired: boolean; tracker: BackfillTracker }> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(trackerRef);
    const tracker = normalizeTracker(snap.exists ? snap.data() : undefined);
    const nowMs = Date.now();

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
    tracker.last_run_at = Timestamp.now();
    tx.set(trackerRef, tracker);

    return { acquired: true, tracker };
  });
}

async function saveTrackerWithLease(
  db: FirebaseFirestore.Firestore,
  trackerRef: DocumentReference<DocumentData>,
  tracker: BackfillTracker,
  owner: string
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(trackerRef);
    const current = normalizeTracker(snap.exists ? snap.data() : undefined);
    const nowMs = Date.now();

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
    tracker.last_run_at = Timestamp.now();
    tx.set(trackerRef, tracker);
  });
}

async function releaseRunLease(
  db: FirebaseFirestore.Firestore,
  trackerRef: DocumentReference<DocumentData>,
  owner: string
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(trackerRef);
    const tracker = normalizeTracker(snap.exists ? snap.data() : undefined);
    if (tracker.run_lease?.owner !== owner) {
      return;
    }

    tracker.run_lease = null;
    tracker.last_run_at = Timestamp.now();
    tx.set(trackerRef, tracker);
  });
}

async function fetchArticleSnapshotsById(
  db: FirebaseFirestore.Firestore,
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
  db: FirebaseFirestore.Firestore,
  batch: BatchEntry[]
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
      Date.now(),
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
  db: FirebaseFirestore.Firestore,
  ids: string[]
): Promise<void> {
  const now = Timestamp.now();
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
  db: FirebaseFirestore.Firestore,
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

  // Cursor reached end of collection; wrap to first page on next run.
  if (cursor) {
    const restart = await pageQuery.get();
    if (!restart.empty) {
      const nextCursor = restart.docs[restart.docs.length - 1]!.id;
      return {
        docs: restart.docs,
        nextCursor,
        exhausted: restart.docs.length < pageSize,
      };
    }
  }

  return { docs: [], nextCursor: null, exhausted: true };
}

async function resolveCanonicalCandidates(
  db: FirebaseFirestore.Firestore,
  userDocs: Array<QueryDocumentSnapshot<DocumentData>>
): Promise<CanonicalCandidate[]> {
  const urlToCanonical = new Map<string, string>();
  const byCanonical = new Map<string, CanonicalCandidate>();

  for (const userDoc of userDocs) {
    const userData = userDoc.data();
    const urlRaw = userData['url'];
    const url = typeof urlRaw === 'string' ? urlRaw.trim() : '';
    if (!url) continue;

    let canonicalItemId = resolveCanonicalFromUserDoc(userDoc.id, userData);

    if (canonicalItemId === userDoc.id) {
      const cached = urlToCanonical.get(url);
      if (cached) {
        canonicalItemId = cached;
      } else {
        const existing = await db
          .collection('articles')
          .where('url', '==', url)
          .limit(1)
          .get();
        if (!existing.empty) {
          canonicalItemId = existing.docs[0]!.id;
        }
        urlToCanonical.set(url, canonicalItemId);
      }
    } else if (!urlToCanonical.has(url)) {
      urlToCanonical.set(url, canonicalItemId);
    }

    const current = byCanonical.get(canonicalItemId);
    if (!current) {
      byCanonical.set(canonicalItemId, {
        canonicalItemId,
        url,
        domain: extractDomain(url),
        sourceUserRefs: [userDoc.ref],
        primaryUserData: userData,
      });
      continue;
    }

    current.sourceUserRefs.push(userDoc.ref);
  }

  return Array.from(byCanonical.values());
}

async function selectEligibleCanonicals(
  db: FirebaseFirestore.Firestore,
  candidates: CanonicalCandidate[],
  tracker: BackfillTracker,
  nowMs: number
): Promise<{
  eligible: EligibleCanonical[];
  nonEligible: NonEligibleCanonical[];
  skippedBackoff: number;
}> {
  const eligible: EligibleCanonical[] = [];
  const nonEligible: NonEligibleCanonical[] = [];
  let skippedBackoff = 0;

  if (candidates.length === 0) {
    return { eligible, nonEligible, skippedBackoff };
  }

  const snapshotsById = await fetchArticleSnapshotsById(
    db,
    candidates.map((candidate) => candidate.canonicalItemId)
  );

  for (const candidate of candidates) {
    if (isDomainBackedOff(tracker, candidate.domain, nowMs)) {
      skippedBackoff += 1;
      nonEligible.push({ candidate, markTriggered: false });
      continue;
    }

    const snapshot = snapshotsById.get(candidate.canonicalItemId);
    if (!snapshot || !snapshot.exists) {
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
        nonEligible.push({ candidate, markTriggered: false });
        continue;
      }
      eligible.push({ candidate, isNew: false, retryCount });
    } else {
      const markTriggered = classification === 'complete' || classification === 'in_progress';
      nonEligible.push({ candidate, markTriggered });
    }
  }

  return { eligible, nonEligible, skippedBackoff };
}

interface UpsertResult {
  articleRef: DocumentReference<DocumentData>;
  hadFirstSeenFailure: boolean;
}

async function upsertArticleBeforeBegin(
  db: FirebaseFirestore.Firestore,
  candidate: CanonicalCandidate,
  retryCount: number
): Promise<UpsertResult> {
  const articleRef = db.collection('articles').doc(candidate.canonicalItemId);
  const existing = await articleRef.get();
  const existingData = existing.exists ? existing.data() : undefined;
  const existingFailure =
    existingData && typeof existingData['failure'] === 'object'
      ? (existingData['failure'] as Record<string, unknown>)
      : null;
  const hadFirstSeenFailure = Boolean(existingFailure?.['first_seen_at']);
  const now = Timestamp.now();

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

export const backfillArchiver = onSchedule(
  {
    schedule: 'every 10 minutes',
    timeZone: 'UTC',
    retryCount: 0,
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET],
  },
  async () => {
    const db = getFirestore();
    const batchSize = BATCH_SIZE.value();
    const scanPageSize = Math.max(batchSize, SCAN_PAGE_SIZE.value());
    const userId = BACKFILL_USER_ID.value();
    const trackerRef = db.doc(TRACKER_DOC_PATH);
    const runOwner = `backfill-${crypto.randomUUID()}`;
    console.log(
      `[backfill] run=${runOwner} starting (batchSize=${batchSize}, scanPageSize=${scanPageSize}, userId=${userId})`
    );

    const { acquired, tracker: loadedTracker } = await acquireRunLease(
      db,
      trackerRef,
      runOwner
    );

    if (!acquired) {
      console.log(`[backfill] run=${runOwner} another run owns lease, skipping`);
      return;
    }

    const tracker = loadedTracker;

    try {
      pruneExpiredDomainBackoff(tracker, Date.now());

      if (
        tracker.paused &&
        tracker.global_pause_until &&
        tracker.global_pause_until.toMillis() > Date.now()
      ) {
        console.log(
          `[backfill] run=${runOwner} globally paused until ${tracker.global_pause_until.toDate().toISOString()}`
        );
        tracker.last_run_result = 'backoff';
        tracker.last_run_summary = createDefaultRunSummary();
        await saveTrackerWithLease(db, trackerRef, tracker, runOwner);
        return;
      }

      if (
        tracker.paused &&
        (!tracker.global_pause_until ||
          tracker.global_pause_until.toMillis() <= Date.now())
      ) {
        tracker.paused = false;
        tracker.global_pause_until = null;
        tracker.pause_reason = null;
      }

      if (tracker.batch.length > 0) {
        console.log(
          `[backfill] run=${runOwner} checking active batch #${tracker.batch_number} (${tracker.batch.length} items)`
        );
        const settlement = await checkBatchSettlement(db, tracker.batch);

        if (settlement.stuckIds.length > 0) {
          console.warn(
            `[backfill] run=${runOwner} marking ${settlement.stuckIds.length} stuck items as failed`
          );
          await markStuckAsFailed(db, settlement.stuckIds);
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
          await saveTrackerWithLease(db, trackerRef, tracker, runOwner);
          return;
        }

        const nowMs = Date.now();
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

        await saveTrackerWithLease(db, trackerRef, tracker, runOwner);
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

      const page = await fetchUserArticlesPage(
        db,
        userId,
        tracker.scan_cursor,
        scanPageSize
      );
      const userArticles = page.docs;

      const runSummary = createDefaultRunSummary();
      runSummary.considered = userArticles.length;

      if (userArticles.length === 0) {
        console.log(`[backfill] run=${runOwner} no user articles found`);
        tracker.scan_cursor = null;
        tracker.scan_exhausted = true;
        tracker.last_run_result = 'idle';
        tracker.last_run_summary = runSummary;
        await saveTrackerWithLease(db, trackerRef, tracker, runOwner);
        return;
      }

      const candidates = await resolveCanonicalCandidates(db, userArticles);
      const { eligible, nonEligible, skippedBackoff } =
        await selectEligibleCanonicals(db, candidates, tracker, Date.now());

      runSummary.eligible = eligible.length;
      runSummary.skipped_backoff = skippedBackoff;
      console.log(
        `[backfill] run=${runOwner} pageDocs=${userArticles.length} candidates=${candidates.length} eligible=${eligible.length} skippedBackoff=${skippedBackoff} cursor=${tracker.scan_cursor ?? 'null'} next=${page.nextCursor ?? 'null'} exhausted=${page.exhausted}`
      );

      for (const item of nonEligible) {
        await linkSourceUserDocs(item.candidate, item.markTriggered);
        if (item.markTriggered) {
          runSummary.linked_only += item.candidate.sourceUserRefs.length;
        }
      }

      if (eligible.length === 0) {
        console.log(`[backfill] run=${runOwner} no eligible items to start`);
        tracker.scan_cursor = page.exhausted ? null : page.nextCursor;
        tracker.scan_exhausted = page.exhausted;
        tracker.last_run_result = runSummary.skipped_backoff > 0 ? 'backoff' : 'idle';
        tracker.last_run_summary = runSummary;
        await saveTrackerWithLease(db, trackerRef, tracker, runOwner);
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
          retryCount
        );

        try {
          const beginResponse = await callGatewayBegin(
            {
              gatewayUrl: GATEWAY_URL.value(),
              publicApiKey: PUBLIC_API_KEY.value(),
              cfAccessClientId: process.env['CF_ACCESS_CLIENT_ID'] ?? '',
              cfAccessClientSecret:
                process.env['CF_ACCESS_CLIENT_SECRET'] ?? '',
            },
            {
              url: item.candidate.url,
              request_id: item.candidate.canonicalItemId,
              includeScreenshot: true,
              includePdf: true,
            }
          );

          const requestId = beginResponse.requestId ?? beginResponse.request_id;
          if (!requestId) {
            throw new Error('Gateway begin returned no request id');
          }

          // status is derived by articleStatusDerive; processing_started_at
          // is the signal the trigger uses to compute `processing`.
          await articleRef.set(
            {
              warg_request_id: requestId,
              processing_started_at: Timestamp.now(),
              updated_at: Timestamp.now(),
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
            sent_at: Timestamp.now(),
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
          const failedAt = Timestamp.now();
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
            Date.now(),
            DOMAIN_FAILURE_THRESHOLD,
            DOMAIN_BACKOFF_MS,
            message
          );
        }

        if (i < itemsToSend.length - 1) {
          await sleep(STAGGER_MS);
        }
      }

      tracker.batch = batchEntries;
      tracker.batch_started_at = batchEntries.length > 0 ? Timestamp.now() : null;
      tracker.scan_cursor = page.exhausted ? null : page.nextCursor;
      tracker.scan_exhausted = page.exhausted;
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
        tracker.global_pause_until = Timestamp.fromMillis(Date.now() + GLOBAL_PAUSE_MS);
        tracker.last_run_result = 'backoff';
        console.error(
          `[backfill] run=${runOwner} entering global pause (${GLOBAL_PAUSE_MS / 60000}m) due to auth/access failures`
        );
      }

      await saveTrackerWithLease(db, trackerRef, tracker, runOwner);
      console.log(
        `[backfill] run=${runOwner} completed result=${tracker.last_run_result} summary=${JSON.stringify(runSummary)}`
      );
    } finally {
      try {
        await releaseRunLease(db, trackerRef, runOwner);
      } catch (error) {
        console.error(`[backfill] Failed to release run lease: ${errorMessage(error)}`);
      }
    }
  }
);

export const backfillStatus = onRequest(
  { cors: true, memory: '512MiB' },
  async (req, res) => {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const apiKey = req.headers['x-internal-api-key'];
    const providedApiKey =
      typeof apiKey === 'string' ? apiKey : Array.isArray(apiKey) ? apiKey[0] : null;

    if (!hasValidInternalApiKey(providedApiKey, INTERNAL_API_KEY.value())) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const db = getFirestore();
    const trackerSnap = await db.doc(TRACKER_DOC_PATH).get();
    const tracker = normalizeTracker(trackerSnap.exists ? trackerSnap.data() : undefined);

    if (!trackerSnap.exists) {
      res.json({ status: 'not_initialized', tracker: null });
      return;
    }

    const includeAbandoned = req.query['include_abandoned'] === '1';
    if (!includeAbandoned) {
      res.json({ status: 'ok', tracker });
      return;
    }

    const limitRaw = Number(req.query['limit']);
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 100;

    const abandonedSnap = await db
      .collection('articles')
      .where('status', '==', 'abandoned')
      .limit(limit)
      .get();

    const classBreakdown: Record<string, number> = {};
    const items: Array<{
      item_id: string;
      url?: string;
      domain?: string;
      class?: string;
      last_error_message?: string;
      retry_count?: number;
      failed_at?: string;
    }> = [];

    for (const doc of abandonedSnap.docs) {
      const data = doc.data();
      const failure = (data['failure'] as Record<string, unknown> | undefined) ?? {};
      const cls = typeof failure['class'] === 'string' ? failure['class'] : 'UNKNOWN';
      classBreakdown[cls] = (classBreakdown[cls] ?? 0) + 1;
      const failedAt = data['failed_at'];
      items.push({
        item_id: doc.id,
        ...(typeof data['url'] === 'string' ? { url: data['url'] } : {}),
        ...(typeof data['domain'] === 'string' ? { domain: data['domain'] } : {}),
        ...(typeof cls === 'string' ? { class: cls } : {}),
        ...(typeof failure['last_error_message'] === 'string'
          ? { last_error_message: failure['last_error_message'] as string }
          : {}),
        ...(typeof data['retry_count'] === 'number'
          ? { retry_count: data['retry_count'] }
          : {}),
        ...(failedAt && typeof failedAt === 'object' &&
          typeof (failedAt as { toDate?: unknown }).toDate === 'function'
            ? { failed_at: (failedAt as { toDate: () => Date }).toDate().toISOString() }
            : {}),
      });
    }

    res.json({
      status: 'ok',
      tracker,
      abandoned: {
        sampled: items.length,
        limit,
        class_breakdown: classBreakdown,
        items,
      },
    });
  }
);
