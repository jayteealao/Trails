import type { DocumentData } from 'firebase-admin/firestore';
import type { ArchiveClassification, ArchiveStatus } from './types.js';
import { CORE_ARCHIVES, ALL_ARCHIVE_KEYS } from './types.js';

/**
 * Build per-archive status list from canonical article's archives map.
 * Keys not present in the doc are marked 'absent'.
 */
export function buildArchiveStatuses(
  archives: Record<string, { status?: string; gcs_path?: string; compressed_size?: number; created_at?: string }> | undefined
): ArchiveStatus[] {
  return ALL_ARCHIVE_KEYS.map((key) => {
    const entry = archives?.[key];
    if (!entry) {
      return { key, status: 'absent' as const };
    }
    return {
      key,
      status: (entry.status as ArchiveStatus['status']) ?? 'absent',
      gcs_path: entry.gcs_path,
      compressed_size: entry.compressed_size,
      created_at: entry.created_at,
    };
  });
}

/**
 * Classify an article's overall archive completeness.
 *
 * - No canonical doc → 'unarchived'
 * - status='failed' → 'failed'
 * - status='processing' or 'pending' → 'processing'
 * - No archives map → 'unarchived'
 * - All 4 core archives succeeded → 'complete'
 * - Some succeeded → 'incomplete'
 * - Any failed with none succeeded → 'failed'
 */
export function classifyArchiveStatus(
  canonicalDoc: DocumentData | undefined
): ArchiveClassification {
  if (!canonicalDoc) return 'unarchived';

  const status = canonicalDoc['status'] as string | undefined;
  const archives = canonicalDoc['archives'] as
    | Record<string, { status: string }>
    | undefined;

  if (status === 'failed') return 'failed';
  if (status === 'processing' || status === 'pending') return 'processing';

  if (!archives || Object.keys(archives).length === 0) return 'unarchived';

  const coreStatuses = CORE_ARCHIVES.map((key) => archives[key]?.status);
  const allCoreSuccess = coreStatuses.every((s) => s === 'success');
  if (allCoreSuccess) return 'complete';

  const anySuccess = coreStatuses.some((s) => s === 'success');
  if (anySuccess) return 'incomplete';

  const anyFailed = coreStatuses.some((s) => s === 'failed');
  if (anyFailed) return 'failed';

  return 'incomplete';
}
