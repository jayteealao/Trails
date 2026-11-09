import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { Request, Response } from 'express';
import {
  markSharedArticleProcessing,
  readSharedArticle,
  resolveCanonicalItemId,
  setUserArticleResolvedLink,
} from '@warg/article-writer';
import { getDashboardUserId } from './config.js';
import { SAFE_ID_RE, extractDomain } from '@warg/shared/archive-ids';

interface MarkProcessingBody {
  requestId?: unknown;
}

/**
 * POST /articles/:itemId/mark-processing handler.
 * Marks canonical article as processing and links user article.
 */
export async function handleMarkProcessing(
  req: Request,
  res: Response,
  itemId: string,
  deps: { db?: Firestore; userId?: string } = {}
): Promise<void> {
  if (!SAFE_ID_RE.test(itemId)) {
    res.status(400).json({ error: 'Invalid itemId format' });
    return;
  }

  const body = (req.body ?? {}) as MarkProcessingBody;
  const bodyRequestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  const requestId = bodyRequestId.length > 0 ? bodyRequestId : itemId;

  if (!SAFE_ID_RE.test(requestId)) {
    res.status(400).json({ error: 'Invalid requestId format' });
    return;
  }

  const db = deps.db ?? getFirestore();
  const userId = deps.userId ?? getDashboardUserId();
  const userRef = db.collection('users').doc(userId).collection('articles').doc(itemId);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    res.status(404).json({ error: 'User article not found' });
    return;
  }

  const userDoc = userSnap.data() as Record<string, unknown>;
  const linkId = resolveCanonicalItemId(itemId, userDoc);
  const shared = await readSharedArticle(db, linkId);
  const canonicalItemId = shared?.id ?? linkId;
  const url = typeof userDoc['url'] === 'string' ? userDoc['url'] : '';
  const now = Timestamp.now();

  await markSharedArticleProcessing(
    db.collection('articles').doc(canonicalItemId),
    { itemId: canonicalItemId, url, domain: extractDomain(url), requestId },
    now
  );
  await setUserArticleResolvedLink(userRef, { resolvedId: canonicalItemId, archivalTriggered: true });

  res.json({ itemId, canonicalItemId, requestId, updated: true });
}
