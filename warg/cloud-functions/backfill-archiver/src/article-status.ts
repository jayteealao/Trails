// Single source of truth for article completeness and derived status.
// Imported by eligibility.ts (backfill classifier) and the
// articleStatusDerive Firestore trigger so both agree on the rules.

import type { DocumentData } from 'firebase-admin/firestore';

export type ArticleStatus =
  | 'pending'
  | 'processing'
  | 'complete'
  | 'partial'
  | 'failed'
  | 'abandoned';

export const SUFFICIENT_ARCHIVES = ['rendered', 'singlefile', 'monolith'] as const;
export const MAX_RETRIES = 2;
// Workstream C3 backstop — covers the observed ~43-min real wall-clock tail.
// Keep in sync with backfill index.ts and scripts/reconcile-status.mjs.
export const STUCK_TIMEOUT_MS = 45 * 60 * 1000;

type ArchiveMap = Record<string, { status?: string } | undefined>;

function archiveMap(doc: DocumentData): ArchiveMap {
  const archives = doc['archives'];
  return archives && typeof archives === 'object' && !Array.isArray(archives)
    ? (archives as ArchiveMap)
    : {};
}

export function hasSufficientArtifact(doc: DocumentData): boolean {
  const archives = archiveMap(doc);
  return SUFFICIENT_ARCHIVES.some((key) => archives[key]?.status === 'success');
}

export function hasAnySuccessfulArchive(doc: DocumentData): boolean {
  const archives = archiveMap(doc);
  for (const entry of Object.values(archives)) {
    if (entry?.status === 'success') return true;
  }
  return false;
}

interface MaybeTimestamp {
  toMillis: () => number;
}

function toMillisOrNull(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const ts = value as Partial<MaybeTimestamp>;
  return typeof ts.toMillis === 'function' ? ts.toMillis() : null;
}

function readRetryCount(doc: DocumentData): number {
  const raw = doc['retry_count'];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

function readFailureClass(doc: DocumentData): string | null {
  const failure = doc['failure'];
  if (!failure || typeof failure !== 'object') return null;
  const cls = (failure as Record<string, unknown>)['class'];
  return typeof cls === 'string' ? cls : null;
}

/**
 * Derive the canonical status from an article document. The result is a pure
 * function of the document and the current time — every caller (trigger,
 * reconciler, classifier) agrees on the outcome.
 *
 * Precedence:
 *   1. complete   — sufficient renderable artifact present
 *   2. abandoned  — DATA_ISSUE failure, or retries exhausted with no artifact
 *   3. processing — workflow run in flight (started within STUCK_TIMEOUT_MS)
 *   4. partial    — at least one successful archive but not sufficient
 *   5. failed     — explicit failure recorded
 *   6. pending    — row exists, nothing started yet
 */
export function deriveStatus(
  doc: DocumentData,
  nowMs: number,
  stuckTimeoutMs: number = STUCK_TIMEOUT_MS
): ArticleStatus {
  if (hasSufficientArtifact(doc)) return 'complete';

  const failureClass = readFailureClass(doc);
  const retryCount = readRetryCount(doc);

  if (failureClass === 'DATA_ISSUE') return 'abandoned';

  const processingStartedAtMs = toMillisOrNull(doc['processing_started_at']);
  if (
    processingStartedAtMs !== null &&
    nowMs - processingStartedAtMs <= stuckTimeoutMs
  ) {
    return 'processing';
  }

  const archives = archiveMap(doc);
  const archiveSettlement = archives['workflow_settlement'];
  const archiveGatewayBegin = archives['gateway_begin'];
  // Legacy signal: top-level `error` written by older markStuckAsFailed /
  // failure branches that pre-date the archives-based settlement. Keep
  // recognizing it so the migration doesn't downgrade those rows to pending.
  const hasLegacyError =
    typeof doc['error'] === 'string' && doc['error'].length > 0;
  const hasFailureSignal =
    archiveSettlement?.status === 'stuck' ||
    archiveSettlement?.status === 'failed' ||
    archiveGatewayBegin?.status === 'failed' ||
    failureClass !== null ||
    hasLegacyError;

  if (hasFailureSignal) {
    if (retryCount >= MAX_RETRIES && !hasAnySuccessfulArchive(doc)) {
      return 'abandoned';
    }
    if (hasAnySuccessfulArchive(doc)) return 'partial';
    return 'failed';
  }

  if (hasAnySuccessfulArchive(doc)) return 'partial';
  return 'pending';
}
