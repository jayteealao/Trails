import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import worker from './index.js';

/**
 * GET /stats over the migrated D1 index.
 *
 * /stats counts the whole table, so each test starts from an empty
 * requests_index. Times are relative to now and sit at least one minute
 * from every window edge (10 minutes, 1 hour, 24 hours).
 */

const API_KEY = 'verify-test-key-local-only';
const MINUTE = 60_000;

interface StatsRow {
  requestId: string;
  domain: string;
  stage: string | null;
  terminalState: number;
  minutesAgo: number;
  lastEventTs: string | null;
}

function ago(now: number, minutes: number): string {
  return new Date(now - minutes * MINUTE).toISOString();
}

async function insertRows(db: D1Database, now: number, rows: StatsRow[]): Promise<void> {
  const insert = db.prepare(
    `INSERT INTO requests_index
       (request_id, url, domain, created_at, updated_at, last_event_ts, terminal_state, stage)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  await db.batch(
    rows.map((row) => {
      const createdAt = ago(now, row.minutesAgo);
      return insert.bind(
        row.requestId,
        `https://${row.domain}/${row.requestId}`,
        row.domain,
        createdAt,
        createdAt,
        row.lastEventTs,
        row.terminalState,
        row.stage
      );
    })
  );
}

/**
 * The fixed data set: 21 feature rows on a.example and 75 filler rows
 * (stage done, three days old) spread over b..l.example so that every domain
 * count is distinct and the top-10 cut falls between 4 and 2.
 */
function fixtureRows(now: number): StatsRow[] {
  const event = ago(now, 1);
  const feature: StatsRow[] = [
    // Rows either side of each activity window.
    { requestId: 'w-59m', domain: 'a.example', stage: 'done', terminalState: 1, minutesAgo: 59, lastEventTs: event },
    { requestId: 'w-61m', domain: 'a.example', stage: 'done', terminalState: 1, minutesAgo: 61, lastEventTs: event },
    { requestId: 'w-23h', domain: 'a.example', stage: 'done', terminalState: 1, minutesAgo: 23 * 60, lastEventTs: event },
    { requestId: 'w-25h', domain: 'a.example', stage: 'done', terminalState: 1, minutesAgo: 25 * 60, lastEventTs: event },
    // Queued rows no event has reached, either side of 10 minutes and 1 hour.
    { requestId: 'q-2m', domain: 'a.example', stage: 'queued', terminalState: 0, minutesAgo: 2, lastEventTs: null },
    { requestId: 'q-9m', domain: 'a.example', stage: 'queued', terminalState: 0, minutesAgo: 9, lastEventTs: null },
    { requestId: 'q-11m', domain: 'a.example', stage: 'queued', terminalState: 0, minutesAgo: 11, lastEventTs: null },
    { requestId: 'q-30m', domain: 'a.example', stage: 'queued', terminalState: 0, minutesAgo: 30, lastEventTs: null },
    { requestId: 'q-2h', domain: 'a.example', stage: 'queued', terminalState: 0, minutesAgo: 120, lastEventTs: null },
    // Queued with an event (not an orphan) and with a blank event time (an orphan).
    { requestId: 'q-evented', domain: 'a.example', stage: 'queued', terminalState: 0, minutesAgo: 120, lastEventTs: event },
    { requestId: 'q-blank', domain: 'a.example', stage: 'queued', terminalState: 0, minutesAgo: 180, lastEventTs: '  ' },
    // In-flight rows either side of the one-hour stuck line.
    { requestId: 'r-90m', domain: 'a.example', stage: 'rendering', terminalState: 0, minutesAgo: 90, lastEventTs: event },
    { requestId: 'r-59m', domain: 'a.example', stage: 'rendering', terminalState: 0, minutesAgo: 59, lastEventTs: event },
    // A row with no stage.
    { requestId: 'n-5m', domain: 'a.example', stage: null, terminalState: 0, minutesAgo: 5, lastEventTs: null },
  ];
  // Seven failures so the newest-five cut applies; f-1 is the newest.
  for (let i = 1; i <= 7; i++) {
    feature.push({
      requestId: `f-${i}`,
      domain: 'a.example',
      stage: 'failed',
      terminalState: 1,
      minutesAgo: 90 + i * 10,
      lastEventTs: event,
    });
  }

  const fillerCounts: [string, number][] = [
    ['b.example', 12], ['c.example', 11], ['d.example', 10], ['e.example', 9], ['f.example', 8],
    ['g.example', 7], ['h.example', 6], ['i.example', 5], ['j.example', 4], ['k.example', 2], ['l.example', 1],
  ];
  const filler: StatsRow[] = fillerCounts.flatMap(([domain, count]) =>
    Array.from({ length: count }, (_, i) => ({
      requestId: `${domain}-${i}`,
      domain,
      stage: 'done',
      terminalState: 1,
      minutesAgo: 3 * 24 * 60,
      lastEventTs: event,
    }))
  );
  return [...feature, ...filler];
}

function expectedStats(now: number): unknown {
  const failure = (i: number) => ({
    requestId: `f-${i}`,
    url: `https://a.example/f-${i}`,
    createdAt: ago(now, 90 + i * 10),
  });
  return {
    total: 96,
    byStage: { unknown: 1, done: 79, failed: 7, queued: 7, rendering: 2 },
    successRate: 0.919,
    failureRate: 0.081,
    activeCount: 10,
    stuckCount: 4,
    orphanQueue: { total: 6, olderThan10m: 4, olderThan60m: 2 },
    recentActivity: { last1h: 7, last24h: 20 },
    topDomains: [
      { domain: 'a.example', count: 21 },
      { domain: 'b.example', count: 12 },
      { domain: 'c.example', count: 11 },
      { domain: 'd.example', count: 10 },
      { domain: 'e.example', count: 9 },
      { domain: 'f.example', count: 8 },
      { domain: 'g.example', count: 7 },
      { domain: 'h.example', count: 6 },
      { domain: 'i.example', count: 5 },
      { domain: 'j.example', count: 4 },
    ],
    recentFailures: [failure(1), failure(2), failure(3), failure(4), failure(5)],
  };
}

function getStats(db: D1Database): Promise<Response> {
  const request = new Request('https://logger.internal/stats', {
    headers: { 'X-Internal-API-Key': API_KEY },
  });
  return worker.fetch(request, { ...env, INTERNAL_API_KEY: API_KEY, INDEX_DB: db });
}

beforeEach(async () => {
  await env.INDEX_DB.prepare('DELETE FROM requests_index').run();
});

describe('GET /stats', () => {
  it('returns the stage, window, orphan, domain and failure figures of a fixed set of rows', async () => {
    const now = Date.now();
    await insertRows(env.INDEX_DB, now, fixtureRows(now));

    const res = await getStats(env.INDEX_DB);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(JSON.stringify(expectedStats(now)));
  });

  it('returns zero counts and empty lists for an empty index', async () => {
    const res = await getStats(env.INDEX_DB);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(
      '{"total":0,"byStage":{},"successRate":0,"failureRate":0,"activeCount":0,"stuckCount":0,' +
        '"orphanQueue":{"total":0,"olderThan10m":0,"olderThan60m":0},' +
        '"recentActivity":{"last1h":0,"last24h":0},"topDomains":[],"recentFailures":[]}'
    );
  });
});
