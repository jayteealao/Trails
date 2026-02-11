import { getFirestore } from 'firebase-admin/firestore';
import type { DocumentReference, DocumentData } from 'firebase-admin/firestore';
import type { Request, Response } from 'express';
import type { ArchiveClassification, ArticleListItem, ArticleListResponse } from './types.js';
import { classifyArchiveStatus, buildArchiveStatuses } from './classify.js';

const USER_ID = 'TGtRF6GrQaSmfjGk9GEYJ8YZc0v1';
const CHUNK_SIZE = 500;

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function timestampToIso(ts: unknown): string {
  if (!ts) return '';
  // Firestore Timestamp object
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts) {
    return (ts as { toDate: () => Date }).toDate().toISOString();
  }
  // Already a string
  if (typeof ts === 'string') return ts;
  return '';
}

/**
 * Batch-fetch canonical article docs for a list of item IDs.
 * Returns a Map of itemId -> DocumentData (or undefined if not found).
 */
async function batchFetchCanonicals(
  itemIds: string[]
): Promise<Map<string, DocumentData>> {
  const db = getFirestore();
  const result = new Map<string, DocumentData>();

  for (let i = 0; i < itemIds.length; i += CHUNK_SIZE) {
    const chunk = itemIds.slice(i, i + CHUNK_SIZE);
    const refs: DocumentReference[] = chunk.map((id) =>
      db.collection('articles').doc(id)
    );
    const snapshots = await db.getAll(...refs);

    for (const snap of snapshots) {
      if (snap.exists) {
        result.set(snap.id, snap.data()!);
      }
    }
  }

  return result;
}

/**
 * Merge a user article doc + optional canonical doc into an ArticleListItem.
 */
function mergeArticle(
  itemId: string,
  userDoc: DocumentData,
  canonicalDoc: DocumentData | undefined
): ArticleListItem {
  const url = (userDoc['url'] as string) ?? '';
  const title =
    (canonicalDoc?.['metadata'] as Record<string, unknown> | undefined)?.['title'] as string | undefined ??
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

  return {
    item_id: itemId,
    url,
    title: title ?? undefined,
    domain,
    created_at: createdAt,
    archive_classification: classifyArchiveStatus(canonicalDoc),
    archives: buildArchiveStatuses(archives),
    warg_request_id: canonicalDoc?.['warg_request_id'] as string | undefined,
    has_canonical: canonicalDoc !== undefined,
  };
}

/**
 * GET /articles handler.
 * Query params: page, limit, filter (ArchiveClassification), search (URL/domain substring).
 */
export async function handleListArticles(
  req: Request,
  res: Response
): Promise<void> {
  const db = getFirestore();

  const page = Math.max(1, parseInt(req.query['page'] as string, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string, 10) || 50));
  const filter = (req.query['filter'] as string) || '';
  const search = (req.query['search'] as string)?.toLowerCase() || '';

  // Fetch user articles ordered by timeAdded desc (hard cap to prevent OOM)
  const MAX_ARTICLES = 2000;
  const userArticlesSnap = await db
    .collection('users')
    .doc(USER_ID)
    .collection('articles')
    .orderBy('timeAdded', 'desc')
    .limit(MAX_ARTICLES)
    .get();

  if (userArticlesSnap.empty) {
    res.json({ articles: [], total: 0, page, limit, hasMore: false });
    return;
  }

  // Batch-fetch canonical docs
  const itemIds = userArticlesSnap.docs.map((doc) => doc.id);
  const canonicals = await batchFetchCanonicals(itemIds);

  // Merge into ArticleListItems
  let articles: ArticleListItem[] = userArticlesSnap.docs.map((doc) =>
    mergeArticle(doc.id, doc.data(), canonicals.get(doc.id))
  );

  // Apply filter
  if (filter) {
    articles = articles.filter(
      (a) => a.archive_classification === (filter as ArchiveClassification)
    );
  }

  // Apply search
  if (search) {
    articles = articles.filter(
      (a) =>
        a.url.toLowerCase().includes(search) ||
        a.domain.toLowerCase().includes(search) ||
        (a.title?.toLowerCase().includes(search) ?? false)
    );
  }

  const total = articles.length;
  const start = (page - 1) * limit;
  const paged = articles.slice(start, start + limit);
  const hasMore = start + limit < total;

  const response: ArticleListResponse = {
    articles: paged,
    total,
    page,
    limit,
    hasMore,
  };

  res.json(response);
}
