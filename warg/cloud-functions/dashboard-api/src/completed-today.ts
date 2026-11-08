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

/**
 * GET /stats/completed-today handler: the dashboard user's articles (the same
 * bounded read as the filtered list) that became complete since UTC midnight.
 */
export async function handleCompletedToday(
  _req: Request,
  res: Response,
  deps: { db?: Firestore; userId?: string; now?: () => Date } = {}
): Promise<void> {
  const since = startOfUtcDay((deps.now ?? (() => new Date()))());
  const items = await readMergedUserArticles(
    deps.db ?? getFirestore(),
    deps.userId ?? getDashboardUserId()
  );
  const body: CompletedTodayResponse = {
    completedToday: countCompletedSince(items, since.getTime()),
    since: since.toISOString(),
  };
  res.json(body);
}
