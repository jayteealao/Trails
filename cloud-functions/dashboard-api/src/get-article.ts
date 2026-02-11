import { getFirestore } from 'firebase-admin/firestore';
import type { Request, Response } from 'express';
import type { ArticleDetail } from './types.js';
import { classifyArchiveStatus, buildArchiveStatuses } from './classify.js';

const USER_ID = 'TGtRF6GrQaSmfjGk9GEYJ8YZc0v1';

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function timestampToIso(ts: unknown): string {
  if (!ts) return '';
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts) {
    return (ts as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof ts === 'string') return ts;
  return '';
}

/**
 * GET /articles/:itemId handler.
 * Returns full article detail with metadata, archives, and cross-system IDs.
 */
export async function handleGetArticle(
  req: Request,
  res: Response,
  itemId: string
): Promise<void> {
  const db = getFirestore();

  // Fetch user article and canonical article in parallel
  const [userSnap, canonicalSnap] = await Promise.all([
    db.collection('users').doc(USER_ID).collection('articles').doc(itemId).get(),
    db.collection('articles').doc(itemId).get(),
  ]);

  if (!userSnap.exists) {
    res.status(404).json({ error: 'Article not found' });
    return;
  }

  const userDoc = userSnap.data()!;
  const canonicalDoc = canonicalSnap.exists ? canonicalSnap.data()! : undefined;

  const url = (userDoc['url'] as string) ?? '';
  const canonicalMeta = canonicalDoc?.['metadata'] as Record<string, unknown> | undefined;

  const title =
    (canonicalMeta?.['title'] as string | undefined) ??
    (userDoc['title'] as string | undefined) ??
    (userDoc['resolvedTitle'] as string | undefined);

  const domain =
    (canonicalDoc?.['domain'] as string | undefined) ?? extractDomain(url);

  const createdAt =
    timestampToIso(canonicalDoc?.['created_at']) ||
    timestampToIso(userDoc['timeAdded']);

  const archives = canonicalDoc?.['archives'] as
    | Record<string, { status?: string; gcs_path?: string; compressed_size?: number; created_at?: string }>
    | undefined;

  const detail: ArticleDetail = {
    // Base ArticleListItem fields
    item_id: itemId,
    url,
    title: title ?? undefined,
    domain,
    created_at: createdAt,
    archive_classification: classifyArchiveStatus(canonicalDoc),
    archives: buildArchiveStatuses(archives),
    warg_request_id: canonicalDoc?.['warg_request_id'] as string | undefined,
    has_canonical: canonicalDoc !== undefined,
    // Enriched detail fields
    metadata: canonicalMeta
      ? {
          byline: canonicalMeta['byline'] as string | undefined,
          excerpt: canonicalMeta['excerpt'] as string | undefined,
          published_time: (canonicalMeta['published_time'] as string | null) ?? undefined,
          site_name: (canonicalMeta['site_name'] as string | null) ?? undefined,
          title: canonicalMeta['title'] as string | undefined,
          word_count: canonicalMeta['word_count'] as number | undefined,
        }
      : undefined,
    pocket: userDoc['pocket'] as ArticleDetail['pocket'],
    images: canonicalDoc?.['images'] as ArticleDetail['images'],
    firestore_status: canonicalDoc?.['status'] as string | undefined,
    error: canonicalDoc?.['error'] as string | undefined,
    processing_started_at: timestampToIso(canonicalDoc?.['processing_started_at']) || undefined,
  };

  res.json(detail);
}
