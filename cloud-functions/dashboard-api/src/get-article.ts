import { getFirestore } from 'firebase-admin/firestore';
import type { Request, Response } from 'express';
import type { ArticleDetail } from './types.js';
import { getDashboardUserId } from './config.js';
import { timestampToIso } from './util.js';
import { mergeArticle } from './list-articles.js';

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
  const userId = getDashboardUserId();

  // Fetch user article and canonical article in parallel
  const [userSnap, canonicalSnap] = await Promise.all([
    db.collection('users').doc(userId).collection('articles').doc(itemId).get(),
    db.collection('articles').doc(itemId).get(),
  ]);

  if (!userSnap.exists) {
    res.status(404).json({ error: 'Article not found' });
    return;
  }

  const userDoc = userSnap.data()!;
  const canonicalDoc = canonicalSnap.exists ? canonicalSnap.data()! : undefined;

  // Reuse base fields from mergeArticle
  const base = mergeArticle(itemId, userDoc, canonicalDoc);

  // Enriched detail fields
  const canonicalMeta = canonicalDoc?.['metadata'] as Record<string, unknown> | undefined;

  const detail: ArticleDetail = {
    ...base,
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
