import { getFirestore } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import type { Request, Response } from 'express';
import type { ArticleListItem, CompletedTodayResponse } from './types.js';
import { CORE_ARCHIVES } from './types.js';
import { getDashboardUserId } from './config.js';
import { MAX_FILTERED_ARTICLES, readMergedUserArticles } from './list-articles.js';

const CORE_KEYS: ReadonlySet<string> = new Set(CORE_ARCHIVES);

/** The start of the UTC day that contains `now`, whatever the process time zone. */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * When the article became complete: the newest success time of its core
 * archives (each one is stamped when that archive succeeds). Undefined when no
 * core archive has a time that parses.
 *
 * No stored field records the first completion, so a core archive that is run
 * again and succeeds moves this time: an old article re-archived today counts
 * as completed today.
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

/**
 * How long past COMPLETED_TODAY_TTL_MS a count of the same day is still served
 * while a fresh read runs, so an inbox load never waits on the 2000-article read
 * once a count exists.
 */
export const COMPLETED_TODAY_STALE_MS = 10 * 60_000;

interface CachedCount {
  since: string;
  expiresAt: number;
  body: Promise<CompletedTodayResponse>;
  /** The answer once the read succeeded. */
  settled?: CompletedTodayResponse;
  /** A fresh read started while this count is served stale. */
  refreshing?: boolean;
}

/** Counts by dashboard user, so a burst of inbox loads reads the articles once. */
export type CompletedTodayCache = Map<string, CachedCount>;

const sharedCache: CompletedTodayCache = new Map();

async function countForDay(db: Firestore, userId: string, since: Date): Promise<CompletedTodayResponse> {
  const items = await readMergedUserArticles(db, userId);
  return {
    completedToday: countCompletedSince(items, since.getTime()),
    since: since.toISOString(),
    truncated: items.length >= MAX_FILTERED_ARTICLES,
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

  const startRead = (): CachedCount => {
    const entry: CachedCount = {
      since: since.toISOString(),
      expiresAt: nowMs + COMPLETED_TODAY_TTL_MS,
      body: countForDay(deps.db ?? getFirestore(), userId, since),
    };
    entry.body.then(
      (body) => {
        entry.settled = body;
        cache.set(userId, entry);
      },
      // A failed read is not reused: the next call reads again.
      () => {
        if (cache.get(userId) === entry) cache.delete(userId);
      }
    );
    return entry;
  };

  const cached = cache.get(userId);
  const sameDay = cached?.since === since.toISOString();
  if (cached && sameDay && cached.expiresAt > nowMs) {
    res.json(await cached.body);
    return;
  }
  if (cached && sameDay && cached.settled && cached.expiresAt + COMPLETED_TODAY_STALE_MS > nowMs) {
    // Serve the last count now and read again behind it, once.
    if (!cached.refreshing) {
      cached.refreshing = true;
      const next = startRead();
      next.body.catch(() => {
        cached.refreshing = false;
        if (!cache.has(userId)) cache.set(userId, cached);
      });
    }
    res.json(cached.settled);
    return;
  }
  const entry = startRead();
  cache.set(userId, entry);
  res.json(await entry.body);
}
