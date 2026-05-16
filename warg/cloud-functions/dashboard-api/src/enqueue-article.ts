import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import type { Request, Response } from 'express';
import { getDashboardUserId } from './config.js';

const SAFE_ID_RE = /^[a-zA-Z0-9_-]{8,40}$/;

interface EnqueueBody {
  url?: unknown;
  itemId?: unknown;
  favorite?: unknown;
  status?: unknown;
  timeRead?: unknown;
}

function coerceString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function coerceNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isValidArchiveUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * POST /articles/enqueue handler.
 * Creates a user-article doc to trigger onUserArticleSave.
 */
export async function handleEnqueueArticle(
  req: Request,
  res: Response
): Promise<void> {
  const body = (req.body ?? {}) as EnqueueBody;
  const url = typeof body.url === 'string' ? body.url.trim() : '';

  if (!url) {
    res.status(400).json({ error: 'Missing required field: url' });
    return;
  }
  if (!isValidArchiveUrl(url)) {
    res.status(400).json({ error: 'Invalid URL: only http and https are supported' });
    return;
  }

  const providedItemId =
    typeof body.itemId === 'string' && body.itemId.trim().length > 0
      ? body.itemId.trim()
      : undefined;
  if (providedItemId && !SAFE_ID_RE.test(providedItemId)) {
    res.status(400).json({ error: 'Invalid itemId format' });
    return;
  }

  const db = getFirestore();
  const userId = getDashboardUserId();
  const userArticlesRef = db.collection('users').doc(userId).collection('articles');
  const itemId = providedItemId ?? userArticlesRef.doc().id;
  const userRef = userArticlesRef.doc(itemId);

  const existingSnap = await userRef.get();
  if (existingSnap.exists) {
    res.json({ itemId, queued: false, existed: true });
    return;
  }

  const now = Timestamp.now();
  await userRef.create({
    url,
    favorite: coerceString(body.favorite),
    status: coerceString(body.status),
    timeAdded: now,
    timeRead: coerceNumber(body.timeRead, 0),
    resolvedId: itemId,
    archival_triggered: false,
    queued_at: now,
    queued_by: 'dashboard',
  });

  res.status(201).json({ itemId, queued: true, existed: false });
}
