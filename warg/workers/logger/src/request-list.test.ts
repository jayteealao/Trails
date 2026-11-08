import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';

/**
 * GET /requests over the migrated D1 index.
 *
 * Rows are seeded in 1999 and 2000 and every query is bounded to that range,
 * so rows that other tests write (created now) never enter these pages.
 */

const API_KEY = 'verify-test-key-local-only';

function serviceGet(path: string): Promise<Response> {
  return SELF.fetch(`https://logger.internal${path}`, {
    headers: { 'X-Internal-API-Key': API_KEY },
  });
}

interface ListedRequest {
  requestId: string;
  createdAt: string;
  lastEventTs: string | null;
}

async function listRequests(query: string): Promise<ListedRequest[]> {
  const res = await serviceGet(`/requests?${query}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { requests: ListedRequest[] };
  return body.requests;
}

interface SeedRow {
  requestId: string;
  createdAt: string;
  lastEventTs?: string | null;
  stage?: string;
}

async function seed(rows: SeedRow[]): Promise<void> {
  const insert = env.INDEX_DB.prepare(
    `INSERT INTO requests_index (request_id, url, domain, created_at, updated_at, last_event_ts, stage)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  await env.INDEX_DB.batch(
    rows.map((row) =>
      insert.bind(
        row.requestId,
        `https://example.com/${row.requestId}`,
        'example.com',
        row.createdAt,
        row.createdAt,
        row.lastEventTs ?? null,
        row.stage ?? 'queued'
      )
    )
  );
}

describe('GET /requests', () => {
  it('lists every matching row newest first by default, evented rows included', async () => {
    const prefix = `list-default-${Date.now()}`;
    await seed([
      { requestId: `${prefix}-a`, createdAt: '1999-01-01T00:00:00.000Z' },
      { requestId: `${prefix}-b`, createdAt: '1999-01-01T01:00:00.000Z', lastEventTs: '1999-01-01T01:00:01.000Z' },
      { requestId: `${prefix}-c`, createdAt: '1999-01-01T02:00:00.000Z' },
    ]);

    const rows = await listRequests(
      'status=queued&from=1999-01-01T00:00:00.000Z&to=1999-12-31T23:59:59.999Z&limit=10'
    );

    expect(rows.map((r) => r.requestId)).toEqual([`${prefix}-c`, `${prefix}-b`, `${prefix}-a`]);
    expect(rows[1].lastEventTs).toBe('1999-01-01T01:00:01.000Z');
  });
});

describe('GET /requests for the orphan sweep', () => {
  const sweepQuery = 'status=queued&events=none&to=2000-01-01T00:30:00.000Z&order=asc';
  const prefix = `list-burst-${Date.now()}`;
  const stuckIds = [1, 2, 3, 4, 5].map((i) => `${prefix}-stuck-${i}`);

  beforeAll(async () => {
    const stuck = stuckIds.map((requestId, i) => ({
      requestId,
      createdAt: `2000-01-01T00:00:0${i + 1}.000Z`,
    }));
    // Older than the stuck rows, but they already have an event.
    const evented = [1, 2, 3].map((i) => ({
      requestId: `${prefix}-evented-${i}`,
      createdAt: `2000-01-01T00:00:00.${i}00Z`,
      lastEventTs: `2000-01-01T00:00:00.${i}50Z`,
    }));
    // A burst of young rows with no event yet, newer than the cutoff.
    const young = Array.from({ length: 150 }, (_, i) => ({
      requestId: `${prefix}-young-${i}`,
      createdAt: new Date(Date.UTC(2000, 0, 1, 1, 0, i)).toISOString(),
    }));
    await seed([...stuck, ...evented, ...young]);
  });

  it('returns only the old rows with no event, oldest first', async () => {
    const rows = await listRequests(`${sweepQuery}&limit=100`);

    expect(rows.map((r) => r.requestId)).toEqual(stuckIds);
  });

  it('pages through the old rows with limit and offset', async () => {
    const rows = await listRequests(`${sweepQuery}&limit=2&offset=2`);

    expect(rows.map((r) => r.requestId)).toEqual(stuckIds.slice(2, 4));
  });
});
