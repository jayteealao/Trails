import { getFirestore } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import type { Request, Response } from 'express';
import type { ArticleListItem, CompletedTodayResponse } from './types.js';
import { CORE_ARCHIVES } from './types.js';
import { getDashboardUserId } from './config.js';
import { readMergedUserArticles } from './list-articles.js';

const CORE_KEYS: ReadonlySet<string> = new Set(CORE_ARCHIVES);

/** The start of the UTC day that contains `now`, whatever the process time zone. */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * When the article became complete: the newest success time of its core
 * archives (each one is stamped when that archive succeeds). Undefined when no
 * core archive has a time that parses.
 */
export function completedAtMs(item: ArticleListItem): number | undefined {
  let newest: number | undefined;
  for (const archive of item.archives) {
    if (!CORE_KEYS.has(archive.key) || archive.status !== 'success' || !archive.created_at) continue;
    const ms = Date.parse(archive.created_at);
    if (Number.isNaN(ms)) continue;
    if (newest === undefined || ms > newest) newest = ms;
  }
  return newest;
}

/** The complete articles whose completion moment is at or after `sinceMs`. */
export function countCompletedSince(items: ArticleListItem[], sinceMs: number): number {
  return items.filter((item) => {
    if (item.archive_classification !== 'complete') return false;
    const at = completedAtMs(item);
    return at !== undefined && at >= sinceMs;
  }).length;
}

/** How long a count is reused before the articles are read again. */
export const COMPLETED_TODAY_TTL_MS = 60_000;

interface CachedCount {
  since: string;
  expiresAt: number;
  body: Promise<CompletedTodayResponse>;
}

/** Counts by dashboard user, so a burst of inbox loads reads the articles once. */
export type CompletedTodayCache = Map<string, CachedCount>;

const sharedCache: CompletedTodayCache = new Map();

async function countForDay(db: Firestore, userId: string, since: Date): Promise<CompletedTodayResponse> {
  const items = await readMergedUserArticles(db, userId);
  return {
    completedToday: countCompletedSince(items, since.getTime()),
    since: since.toISOString(),
  };
}

/**
 * GET /stats/completed-today handler: the dashboard user's articles (the same
 * bounded read as the filtered list) that became complete since UTC midnight.
 * The read covers up to 2000 articles, so the count is reused for
 * COMPLETED_TODAY_TTL_MS (and for every call while a read is in flight); a new
 * UTC day or a failed read starts a fresh one.
 */
export async function handleCompletedToday(
  _req: Request,
  res: Response,
  deps: { db?: Firestore; userId?: string; now?: () => Date; cache?: CompletedTodayCache } = {}
): Promise<void> {
  const nowMs = (deps.now ?? (() => new Date()))().getTime();
  const since = startOfUtcDay(new Date(nowMs));
  const userId = deps.userId ?? getDashboardUserId();
  const cache = deps.cache ?? sharedCache;

  const cached = cache.get(userId);
  let entry: CachedCount;
  if (cached && cached.since === since.toISOString() && cached.expiresAt > nowMs) {
    entry = cached;
  } else {
    entry = {
      since: since.toISOString(),
      expiresAt: nowMs + COMPLETED_TODAY_TTL_MS,
      body: countForDay(deps.db ?? getFirestore(), userId, since),
    };
    cache.set(userId, entry);
    // A failed read is not reused: the next call reads again.
    entry.body.catch(() => {
      if (cache.get(userId) === entry) cache.delete(userId);
    });
  }
  res.json(await entry.body);
}
