import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { Request, Response } from 'express';
import {
  backfillSharedArticleBaseFields,
  bootstrapSharedArticle,
  buildBootstrapBackfillPatch,
  projectPocket,
  readSharedArticle,
  resolveCanonicalItemId,
  setUserArticleResolvedLink,
} from '@warg/article-writer';
import { getDashboardUserId } from './config.js';
import { extractDomain } from '@warg/shared/archive-ids';

const SAFE_ID_RE = /^[a-zA-Z0-9_-]{8,40}$/;

/**
 * POST /articles/:itemId/bootstrap handler.
 * Ensures the canonical article doc exists and has trigger-equivalent base fields.
 */
export async function handleBootstrapArticle(
  _req: Request,
  res: Response,
  itemId: string,
  deps: { db?: Firestore; userId?: string } = {}
): Promise<void> {
  if (!SAFE_ID_RE.test(itemId)) {
    res.status(400).json({ error: 'Invalid itemId format' });
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
  const url = typeof userDoc['url'] === 'string' ? userDoc['url'] : '';
  if (!url) {
    res.status(400).json({ error: 'User article has no URL' });
    return;
  }

  // The shared article is the server-written link (else this item's own id), with a
  // merged duplicate followed once. Linking an unlinked article is the server's job,
  // so there is no URL lookup here: every dashboard path names the same shared doc.
  const linkId = resolveCanonicalItemId(itemId, userDoc);
  const shared = await readSharedArticle(db, linkId);
  const canonicalItemId = shared?.id ?? linkId;
  const linkedExisting = canonicalItemId !== itemId;

  const article = {
    itemId: canonicalItemId,
    url,
    domain: extractDomain(url),
    pocket: projectPocket(userDoc, canonicalItemId),
  };

  const articleRef = db.collection('articles').doc(canonicalItemId);
  const now = Timestamp.now();
  let created = false;
  let patched = false;

  if (!shared) {
    await bootstrapSharedArticle(articleRef, article, now);
    created = true;
  } else {
    // A patch with more than updated_at means a base field is missing.
    const update = buildBootstrapBackfillPatch(shared.data, article, now);
    patched = Object.keys(update).length > 1;
    if (patched) {
      await backfillSharedArticleBaseFields(articleRef, update);
    }
  }

  const shouldStart = canonicalItemId === itemId;

  if (userDoc['resolvedId'] !== canonicalItemId || !shouldStart) {
    await setUserArticleResolvedLink(userRef, {
      resolvedId: canonicalItemId,
      archivalTriggered: !shouldStart,
    });
  }

  const canonicalData = shared?.data;
  const existingRequestId =
    typeof canonicalData?.['warg_request_id'] === 'string'
      ? (canonicalData['warg_request_id'] as string)
      : undefined;

  res.json({
    itemId,
    canonicalItemId,
    created,
    patched,
    linkedExisting,
    shouldStart,
    existingRequestId,
  });
}
