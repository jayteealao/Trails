import type { DocumentData } from 'firebase-admin/firestore';
import type { ItemStatus } from './types.js';

const CORE_ARCHIVES = ['rendered', 'readability', 'markdown', 'singlefile'] as const;

function hasAllCoreArtifacts(doc: DocumentData): boolean {
  const metadata = doc['metadata'] as Record<string, unknown> | undefined;
  const archives = doc['archives'] as
    | Record<string, { status?: string }>
    | undefined;

  if (!metadata || !metadata['title'] || !archives) {
    return false;
  }

  return CORE_ARCHIVES.every((key) => archives[key]?.status === 'success');
}

export function getRetryCount(doc: DocumentData | undefined): number {
  if (!doc) return 0;
  const retryCount = doc['retry_count'];
  return typeof retryCount === 'number' && Number.isFinite(retryCount)
    ? retryCount
    : 0;
}

/**
 * Classify an article's status for backfill settlement/eligibility decisions.
 */
export function classifyItem(
  doc: DocumentData | undefined,
  nowMs: number,
  stuckTimeoutMs: number
): ItemStatus {
  if (!doc) return 'failed';

  const status = doc['status'] as string | undefined;
  const processingStartedAt = doc['processing_started_at'] as
    | { toMillis: () => number }
    | undefined;

  if (hasAllCoreArtifacts(doc)) {
    return 'complete';
  }

  if (status === 'failed' || status === 'incomplete') {
    return 'failed';
  }

  // "done" without core artifacts is terminal-but-incomplete; retry it.
  if (status === 'done') {
    return 'failed';
  }

  if (status === 'processing' && processingStartedAt) {
    const elapsed = nowMs - processingStartedAt.toMillis();
    if (elapsed > stuckTimeoutMs) return 'stuck';
  }

  return 'in_progress';
}
