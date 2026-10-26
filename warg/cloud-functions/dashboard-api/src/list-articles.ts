import { FieldPath, Timestamp, getFirestore } from 'firebase-admin/firestore';
import type { DocumentData, Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import type { Request, Response } from 'express';
import type { ArchiveClassification, ArticleListItem, ArticleListResponse } from './types.js';
import { classifyArchiveStatus, buildArchiveStatuses, buildArticleHealth } from './classify.js';
import { getDashboardUserId } from './config.js';
import {
  extractDomain,
  readSharedArticles,
  resolveCanonicalItemId,
  timestampToIso,
} from './util.js';

/**
 * Merge a user article doc + optional canonical doc into an ArticleListItem.
 */
export function mergeArticle(
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
  const archiveStatuses = buildArchiveStatuses(archives);

  return {
    item_id: itemId,
    url,
    title: title ?? undefined,
    domain,
    created_at: createdAt,
    archive_classification: classifyArchiveStatus(canonicalDoc),
    archives: archiveStatuses,
    health: buildArticleHealth(archiveStatuses),
    warg_request_id: canonicalDoc?.['warg_request_id'] as string | undefined,
    has_canonical: canonicalDoc !== undefined,
  };
}

type CursorValue = { n: number } | { s: number; ns: number } | { t: string };

/**
 * Opaque list cursor: base64url JSON of the last article's timeAdded (type-tagged,
 * so a Timestamp survives) and its document id. Null for a value it cannot carry.
 */
export function encodeListCursor(timeAdded: unknown, id: string): string | null {
  let v: CursorValue;
  if (typeof timeAdded === 'number' && Number.isFinite(timeAdded)) {
    v = { n: timeAdded };
  } else if (timeAdded instanceof Timestamp) {
    v = { s: timeAdded.seconds, ns: timeAdded.nanoseconds };
  } else if (typeof timeAdded === 'string') {
    v = { t: timeAdded };
  } else {
    return null;
  }
  return Buffer.from(JSON.stringify({ v, id })).toString('base64url');
}

export function decodeListCursor(
  token: string
): { value: number | string | Timestamp; id: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const { v, id } = parsed as { v?: unknown; id?: unknown };
  if (typeof id !== 'string' || id.length === 0 || Buffer.byteLength(id) > 1500) return null;
  if (!v || typeof v !== 'object') return null;
  const rec = v as Record<string, unknown>;
  const n = rec['n'];
  if (typeof n === 'number' && Number.isFinite(n)) return { value: n, id };
  const t = rec['t'];
  if (typeof t === 'string') return { value: t, id };
  const seconds = rec['s'];
  const nanos = rec['ns'];
  if (
    typeof seconds === 'number' &&
    typeof nanos === 'number' &&
    Number.isInteger(seconds) &&
    Number.isInteger(nanos) &&
    nanos >= 0 &&
    nanos < 1e9
  ) {
    try {
      return { value: new Timestamp(seconds, nanos), id };
    } catch {
      return null;
    }
  }
  return null;
}

function mergePage(
  docs: Array<QueryDocumentSnapshot<DocumentData>>,
  linkIds: string[],
  shared: Map<string, { data: DocumentData }>
): ArticleListItem[] {
  return docs.map((doc, i) => mergeArticle(doc.id, doc.data(), shared.get(linkIds[i]!)?.data));
}

/**
 * GET /articles handler.
 * Query params: page, limit, cursor, filter (ArchiveClassification), search (URL/domain substring).
 *
 * With no filter and no search the list pages on the server: one page of user
 * articles (after `cursor`, else by offset for a page above 1), the shared docs
 * of that page only, and the total from count(). A filter or a search depends on
 * shared-doc state and text that Firestore cannot query, so those keep the
 * bounded read and the in-memory filter.
 */
export async function handleListArticles(
  req: Request,
  res: Response,
  deps: { db?: Firestore; userId?: string } = {}
): Promise<void> {
  const db = deps.db ?? getFirestore();

  const page = Math.max(1, parseInt(req.query['page'] as string, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query['limit'] as string, 10) || 50));
  const filter = (req.query['filter'] as string) || '';
  const search = (req.query['search'] as string)?.toLowerCase() || '';
  const cursorParam = typeof req.query['cursor'] === 'string' ? req.query['cursor'] : '';

  const userId = deps.userId ?? getDashboardUserId();
  const userArticles = db.collection('users').doc(userId).collection('articles');

  if (!filter && !search) {
    const cursor = cursorParam ? decodeListCursor(cursorParam) : null;
    if (cursorParam && !cursor) {
      res.status(400).json({ error: 'Invalid cursor' });
      return;
    }
    const ordered = userArticles
      .orderBy('timeAdded', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');
    const pageQuery = cursor
      ? ordered.startAfter(cursor.value, cursor.id)
      : page > 1
        ? ordered.offset((page - 1) * limit)
        : ordered;
    const [snap, countSnap] = await Promise.all([
      pageQuery.limit(limit).get(),
      ordered.count().get(),
    ]);
    const total = countSnap.data().count;

    // The shared docs of this page only (merged duplicates followed once).
    const linkIds = snap.docs.map((doc) =>
      resolveCanonicalItemId(doc.id, doc.data() as Record<string, unknown>)
    );
    const shared =
      linkIds.length > 0
        ? await readSharedArticles(db, linkIds)
        : new Map<string, { data: DocumentData }>();
    const last = snap.docs[snap.docs.length - 1];
    const nextCursor =
      last && snap.docs.length === limit
        ? encodeListCursor(last.data()['timeAdded'], last.id)
        : null;

    const response: ArticleListResponse = {
      articles: mergePage(snap.docs, linkIds, shared),
      total,
      page,
      limit,
      hasMore: nextCursor !== null && page * limit < total,
      nextCursor,
    };
    res.json(response);
    return;
  }

  // Fetch user articles ordered by timeAdded desc (hard cap to prevent OOM)
  const MAX_ARTICLES = 2000;
  const userArticlesSnap = await userArticles
    .orderBy('timeAdded', 'desc')
    .limit(MAX_ARTICLES)
    .get();

  if (userArticlesSnap.empty) {
    res.json({ articles: [], total: 0, page, limit, hasMore: false, nextCursor: null });
    return;
  }

  // Batch-fetch the linked shared docs (merged duplicates followed once); no marker reads here.
  const linkIds = userArticlesSnap.docs.map((doc) =>
    resolveCanonicalItemId(doc.id, doc.data() as Record<string, unknown>)
  );
  const shared = await readSharedArticles(db, linkIds);

  // Merge into ArticleListItems
  let articles: ArticleListItem[] = mergePage(userArticlesSnap.docs, linkIds, shared);

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
    nextCursor: null,
  };

  res.json(response);
}
