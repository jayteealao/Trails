import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { Request, Response } from 'express';
import { getDashboardUserId } from './config.js';
import { extractDomain, resolveCanonicalItemId } from './util.js';

const SAFE_ID_RE = /^[a-zA-Z0-9_-]{8,40}$/;

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asPocketTime(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as { toDate: unknown }).toDate === 'function'
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    return Math.floor(date.getTime() / 1000);
  }
  return 0;
}

function buildPocket(
  userDoc: Record<string, unknown>,
  canonicalItemId: string
): Record<string, unknown> {
  const pocket = userDoc['pocket'];
  const pocketObj =
    pocket && typeof pocket === 'object'
      ? (pocket as Record<string, unknown>)
      : undefined;

  return {
    favorite: asString(pocketObj?.['favorite'] ?? userDoc['favorite'], ''),
    resolved_id: asString(
      pocketObj?.['resolved_id'] ?? userDoc['resolvedId'],
      canonicalItemId
    ),
    status: asString(pocketObj?.['status'] ?? userDoc['status'], ''),
    time_added: asPocketTime(pocketObj?.['time_added'] ?? userDoc['timeAdded']),
    time_read: asPocketTime(pocketObj?.['time_read'] ?? userDoc['timeRead']),
  };
}

/**
 * POST /articles/:itemId/bootstrap handler.
 * Ensures the canonical article doc exists and has trigger-equivalent base fields.
 */
export async function handleBootstrapArticle(
  _req: Request,
  res: Response,
  itemId: string
): Promise<void> {
  if (!SAFE_ID_RE.test(itemId)) {
    res.status(400).json({ error: 'Invalid itemId format' });
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
  const url = typeof userDoc['url'] === 'string' ? userDoc['url'] : '';
  if (!url) {
    res.status(400).json({ error: 'User article has no URL' });
    return;
  }

  let canonicalItemId = resolveCanonicalItemId(itemId, userDoc);
  let linkedExisting = canonicalItemId !== itemId;

  // If resolvedId is missing, mirror onUserArticleSave URL de-dupe behavior.
  if (canonicalItemId === itemId) {
    const existingQuery = await db
      .collection('articles')
      .where('url', '==', url)
      .limit(1)
      .get();
    if (!existingQuery.empty) {
      const existingDoc = existingQuery.docs[0]!;
      if (existingDoc.id !== itemId) {
        canonicalItemId = existingDoc.id;
        linkedExisting = true;
        await existingDoc.ref.set(
          {
            'stats.total_saves': FieldValue.increment(1),
            'stats.last_saved_at': Timestamp.now(),
            updated_at: Timestamp.now(),
          },
          { merge: true }
        );
      }
    }
  }

  const pocket = buildPocket(userDoc, canonicalItemId);
  const stats = {
    last_accessed: '',
    total_saves: 1,
    total_views: 0,
  };

  const articleRef = db.collection('articles').doc(canonicalItemId);
  const articleSnap = await articleRef.get();
  const now = Timestamp.now();
  let created = false;
  let patched = false;

  if (!articleSnap.exists) {
    await articleRef.set({
      item_id: canonicalItemId,
      url,
      domain: extractDomain(url),
      created_at: now,
      updated_at: now,
      status: 'pending',
      archives: {},
      pocket,
      stats,
    });
    created = true;
  } else {
    const canonicalDoc = articleSnap.data() as Record<string, unknown>;
    const update: Record<string, unknown> = { updated_at: now };

    if (!canonicalDoc['item_id']) {
      update['item_id'] = canonicalItemId;
      patched = true;
    }
    if (!canonicalDoc['url']) {
      update['url'] = url;
      patched = true;
    }
    if (!canonicalDoc['domain']) {
      update['domain'] = extractDomain(url);
      patched = true;
    }
    if (!canonicalDoc['created_at']) {
      update['created_at'] = now;
      patched = true;
    }
    if (!canonicalDoc['pocket']) {
      update['pocket'] = pocket;
      patched = true;
    }
    if (!canonicalDoc['stats']) {
      update['stats'] = stats;
      patched = true;
    }

    if (Object.keys(update).length > 1) {
      await articleRef.set(update, { merge: true });
    }
  }

  const userPatch: Record<string, unknown> = {
    resolvedId: canonicalItemId,
  };
  const shouldStart = canonicalItemId === itemId;

  if (!shouldStart) {
    userPatch['archival_triggered'] = true;
  }

  if (userDoc['resolvedId'] !== canonicalItemId || !shouldStart) {
    await userRef.set(userPatch, { merge: true });
  }

  const canonicalData = articleSnap.exists
    ? (articleSnap.data() as Record<string, unknown>)
    : undefined;
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
