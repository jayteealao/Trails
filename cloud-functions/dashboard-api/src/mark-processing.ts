import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { Request, Response } from 'express';
import { getDashboardUserId } from './config.js';
import { extractDomain, resolveCanonicalItemId } from './util.js';

const SAFE_ID_RE = /^[a-zA-Z0-9_-]{8,40}$/;

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
  itemId: string
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

  const db = getFirestore();
  const userId = getDashboardUserId();
  const userRef = db.collection('users').doc(userId).collection('articles').doc(itemId);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    res.status(404).json({ error: 'User article not found' });
    return;
  }

  const userDoc = userSnap.data() as Record<string, unknown>;
  const canonicalItemId = resolveCanonicalItemId(itemId, userDoc);
  const url = typeof userDoc['url'] === 'string' ? userDoc['url'] : '';
  const now = Timestamp.now();

  await db.collection('articles').doc(canonicalItemId).set(
    {
      item_id: canonicalItemId,
      url,
      domain: extractDomain(url),
      status: 'processing',
      warg_request_id: requestId,
      processing_started_at: now,
      updated_at: now,
    },
    { merge: true }
  );

  await userRef.set(
    {
      resolvedId: canonicalItemId,
      archival_triggered: true,
    },
    { merge: true }
  );

  res.json({ itemId, canonicalItemId, requestId, updated: true });
}
