import { NO_EVENT_CONDITION } from './request-list-query.js';

const ONE_HOUR_AGO = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')";
const ONE_DAY_AGO = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 hours')";
const TEN_MINUTES_AGO = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')";
const ORPHAN = `stage = 'queued' AND ${NO_EVENT_CONDITION}`;

/**
 * One row per stage: its row count and, among its rows, those in each
 * activity window, those stuck (not terminal and older than an hour) and the
 * queued rows no event has reached yet (in total and older than 10 minutes
 * and an hour).
 */
export const STATS_COUNTS_SQL = `SELECT stage,
  COUNT(*) AS count,
  SUM(CASE WHEN created_at > ${ONE_HOUR_AGO} THEN 1 ELSE 0 END) AS last1h,
  SUM(CASE WHEN created_at > ${ONE_DAY_AGO} THEN 1 ELSE 0 END) AS last24h,
  SUM(CASE WHEN terminal_state = 0 AND created_at < ${ONE_HOUR_AGO} THEN 1 ELSE 0 END) AS stuck,
  SUM(CASE WHEN ${ORPHAN} THEN 1 ELSE 0 END) AS orphan,
  SUM(CASE WHEN ${ORPHAN} AND created_at < ${TEN_MINUTES_AGO} THEN 1 ELSE 0 END) AS orphan10m,
  SUM(CASE WHEN ${ORPHAN} AND created_at < ${ONE_HOUR_AGO} THEN 1 ELSE 0 END) AS orphan60m
FROM requests_index GROUP BY stage`;

/**
 * The 10 busiest domains (kind 'domain') followed by the 5 newest failures
 * (kind 'failure'). The outer ORDER BY keeps each list in its own order.
 */
export const STATS_LISTS_SQL = `SELECT * FROM (
  SELECT 'domain' AS kind, domain, COUNT(*) AS count, NULL AS request_id, NULL AS url, NULL AS created_at
  FROM requests_index GROUP BY domain ORDER BY count DESC LIMIT 10
)
UNION ALL
SELECT * FROM (
  SELECT 'failure' AS kind, NULL, NULL, request_id, url, created_at
  FROM requests_index WHERE stage = 'failed' ORDER BY created_at DESC LIMIT 5
)
ORDER BY kind, count DESC, created_at DESC`;

export interface StatsCountRow {
  stage: string | null;
  count: number;
  last1h: number;
  last24h: number;
  stuck: number;
  orphan: number;
  orphan10m: number;
  orphan60m: number;
}

export interface StatsListRow {
  kind: 'domain' | 'failure';
  domain: string | null;
  count: number | null;
  request_id: string | null;
  url: string | null;
  created_at: string | null;
}

export interface StatsBody {
  total: number;
  byStage: Record<string, number>;
  successRate: number;
  failureRate: number;
  activeCount: number;
  stuckCount: number;
  orphanQueue: { total: number; olderThan10m: number; olderThan60m: number };
  recentActivity: { last1h: number; last24h: number };
  topDomains: { domain: string | null; count: number | null }[];
  recentFailures: { requestId: string | null; url: string | null; createdAt: string | null }[];
}

function roundRate(rate: number): number {
  return Math.round(rate * 1000) / 1000;
}

/** Folds the rows of the two stats queries into the GET /stats response. */
export function buildStatsBody(countRows: StatsCountRow[], listRows: StatsListRow[]): StatsBody {
  const byStage: Record<string, number> = {};
  let total = 0;
  let doneCount = 0;
  let failedCount = 0;
  let activeCount = 0;
  let stuckCount = 0;
  let last1h = 0;
  let last24h = 0;
  let orphan = 0;
  let orphan10m = 0;
  let orphan60m = 0;

  for (const row of countRows) {
    const stage = row.stage ?? 'unknown';
    byStage[stage] = row.count;
    if (stage === 'done') doneCount = row.count;
    else if (stage === 'failed') failedCount = row.count;
    else activeCount += row.count;
    total += row.count;
    stuckCount += row.stuck;
    last1h += row.last1h;
    last24h += row.last24h;
    orphan += row.orphan;
    orphan10m += row.orphan10m;
    orphan60m += row.orphan60m;
  }

  const terminal = doneCount + failedCount;

  return {
    total,
    byStage,
    successRate: terminal > 0 ? roundRate(doneCount / terminal) : 0,
    failureRate: terminal > 0 ? roundRate(failedCount / terminal) : 0,
    activeCount,
    stuckCount,
    orphanQueue: { total: orphan, olderThan10m: orphan10m, olderThan60m: orphan60m },
    recentActivity: { last1h, last24h },
    topDomains: listRows
      .filter((row) => row.kind === 'domain')
      .map((row) => ({ domain: row.domain, count: row.count })),
    recentFailures: listRows
      .filter((row) => row.kind === 'failure')
      .map((row) => ({ requestId: row.request_id, url: row.url, createdAt: row.created_at })),
  };
}
