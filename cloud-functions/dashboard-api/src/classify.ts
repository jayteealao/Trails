import type { DocumentData } from 'firebase-admin/firestore';
import type { ArchiveClassification, ArchiveStatus, ArticleHealth } from './types.js';
import { CORE_ARCHIVES, ALL_ARCHIVE_KEYS } from './types.js';

const ARCHIVE_ALIASES: Partial<Record<string, readonly string[]>> = {
  readability: ['readability', 'readability_json'],
  markdown: ['markdown', 'readability_md'],
};

function resolveArchiveEntry(
  archives: Record<string, { status?: string; gcs_path?: string; compressed_size?: number; created_at?: string }> | undefined,
  key: string
): { status?: string; gcs_path?: string; compressed_size?: number; created_at?: string } | undefined {
  if (!archives) return undefined;
  const aliases = ARCHIVE_ALIASES[key] ?? [key];
  for (const alias of aliases) {
    const entry = archives[alias];
    if (entry) return entry;
  }
  return undefined;
}

/**
 * Build per-archive status list from canonical article's archives map.
 * Keys not present in the doc are marked 'absent'.
 */
export function buildArchiveStatuses(
  archives: Record<string, { status?: string; gcs_path?: string; compressed_size?: number; created_at?: string }> | undefined
): ArchiveStatus[] {
  return ALL_ARCHIVE_KEYS.map((key) => {
    const entry = resolveArchiveEntry(archives, key);
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

  if (!archives || Object.keys(archives).length === 0) {
    if (status === 'failed') return 'failed';
    if (status === 'processing' || status === 'pending') return 'processing';
    return 'unarchived';
  }

  const archiveStatuses = buildArchiveStatuses(
    archives as Record<string, { status?: string; gcs_path?: string; compressed_size?: number; created_at?: string }>
  );
  const statusByKey = new Map(archiveStatuses.map((a) => [a.key, a.status]));
  const coreStatuses = CORE_ARCHIVES.map((key) => statusByKey.get(key));
  const allCoreSuccess = coreStatuses.every((s) => s === 'success');
  if (allCoreSuccess) return 'complete';

  if (status === 'processing' || status === 'pending') return 'processing';

  const anySuccess = coreStatuses.some((s) => s === 'success');
  if (anySuccess) {
    return status === 'failed' ? 'incomplete' : 'incomplete';
  }

  const anyFailed = coreStatuses.some((s) => s === 'failed');
  if (status === 'failed') return 'failed';
  if (anyFailed) return 'failed';

  return 'incomplete';
}

/**
 * Build health signals used by dashboard quick actions.
 */
export function buildArticleHealth(archives: ArchiveStatus[]): ArticleHealth {
  const byKey = new Map(archives.map((a) => [a.key, a.status]));
  const missingCore = CORE_ARCHIVES.filter((k) => byKey.get(k) !== 'success');
  const failedArchives = archives
    .filter((a) => a.status === 'failed')
    .map((a) => a.key);
  const coreSuccess = CORE_ARCHIVES.filter((k) => byKey.get(k) === 'success').length;

  const readablePriority = ['markdown', 'readability', 'singlefile', 'rendered'] as const;
  let bestAvailableArchive: ArticleHealth['bestAvailableArchive'] = null;
  for (const key of readablePriority) {
    if (byKey.get(key) === 'success') {
      bestAvailableArchive = key;
      break;
    }
  }

  return {
    completenessScore: Math.round((coreSuccess / CORE_ARCHIVES.length) * 100),
    missingCore,
    failedArchives,
    bestAvailableArchive,
    recommendedAction: missingCore.length > 0 || failedArchives.length > 0 ? 'retry_missing' : 'none',
  };
}
