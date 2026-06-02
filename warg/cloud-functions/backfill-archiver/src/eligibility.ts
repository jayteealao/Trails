import type { DocumentData } from 'firebase-admin/firestore';
import { hasSufficientArtifact } from './article-status.js';
import type { ItemStatus } from './types.js';

export function getRetryCount(doc: DocumentData | undefined): number {
  if (!doc) return 0;
  const retryCount = doc['retry_count'];
  return typeof retryCount === 'number' && Number.isFinite(retryCount)
    ? retryCount
    : 0;
}

/**
 * Classify an article's status for backfill settlement/eligibility decisions.
 *
 * Returns `complete` when *any* sufficient renderable artifact is present
 * (rendered / singlefile / monolith). See {@link hasSufficientArtifact}.
 */
export function classifyItem(
  doc: DocumentData | undefined,
  nowMs: number,
  stuckTimeoutMs: number
): ItemStatus {
  if (!doc) return 'failed';

  if (hasSufficientArtifact(doc)) return 'complete';

  const status = doc['status'] as string | undefined;
  const processingStartedAt = doc['processing_started_at'] as
    | { toMillis: () => number }
    | undefined;

  if (status === 'failed' || status === 'incomplete' || status === 'abandoned') {
    return 'failed';
  }

  if (status === 'done') {
    return 'failed';
  }

  if (status === 'processing' && processingStartedAt) {
    const elapsed = nowMs - processingStartedAt.toMillis();
    if (elapsed > stuckTimeoutMs) return 'stuck';
  }

  return 'in_progress';
}
