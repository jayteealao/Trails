import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import gateway from './index.js';

const NOW = Date.parse('2026-06-01T12:00:00.000Z');
const MINUTE = 60 * 1000;
const DEFAULT_MIN_AGE_MS = 10 * MINUTE;

interface SeedRow {
  requestId: string;
  url: string;
  createdAt: string;
  lastEventTs: string | null;
  stage: string;
}

function queuedRow(requestId: string, createdAtMs: number, url = `https://example.com/${requestId}`): SeedRow {
  return { requestId, url, createdAt: new Date(createdAtMs).toISOString(), lastEventTs: null, stage: 'queued' };
}

/** 150 queued rows with no event, all younger than the default minimum age. */
function youngBurst(): SeedRow[] {
  return Array.from({ length: 150 }, (_, i) =>
    queuedRow(`young-${i}`, NOW - 9 * MINUTE + Math.floor((i * 8 * MINUTE) / 150))
  );
}

/** 5 queued rows with no event, two hours old. */
function stuckRows(): SeedRow[] {
  return [1, 2, 3, 4, 5].map((i) => queuedRow(`stuck-${i}`, NOW - 120 * MINUTE + i * 1000));
}

/** Old queued rows with no url (the logger's self-heal shape), which the gateway skips. */
function urlLessRows(count: number): SeedRow[] {
  return Array.from({ length: count }, (_, i) => queuedRow(`no-url-${i}`, NOW - 180 * MINUTE + i, ''));
}

/** A logger fake that answers GET /requests by honouring its query parameters over the seeded rows. */
function createEnv(rows: SeedRow[]) {
  const listUrls: URL[] = [];
  const eventPosts: unknown[] = [];
  const loggerFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    if (url.pathname === '/event') {
      eventPosts.push(JSON.parse(String(init?.body)));
      return Response.json({ eventId: eventPosts.length });
    }
    if (url.pathname !== '/requests') {
      return Response.json({ error: 'unexpected logger route' }, { status: 404 });
    }
    listUrls.push(url);
    const params = url.searchParams;
    const status = params.get('status');
    const to = params.get('to');
    const limit = Number(params.get('limit') ?? '50');
    const offset = Number(params.get('offset') ?? '0');
    const matching = rows
      .filter((row) => status === null || row.stage === status)
      .filter((row) => to === null || row.createdAt <= to)
      .filter((row) => params.get('events') !== 'none' || !row.lastEventTs)
      .sort((a, b) =>
        params.get('order') === 'asc'
          ? a.createdAt.localeCompare(b.createdAt)
          : b.createdAt.localeCompare(a.createdAt)
      );
    return Response.json({ requests: matching.slice(offset, offset + limit) });
  });

  const startedIds: string[] = [];
  const workflowFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as { request_id: string };
    startedIds.push(body.request_id);
    return Response.json({ status: 'queued' }, { status: 201 });
  });

  // The sweep reads only these bindings; the fakes stand in for the runtime env.
  const env = {
    PUBLIC_API_KEY: 'public-key',
    INTERNAL_API_KEY: 'internal-key',
    LOGGER: { fetch: loggerFetch },
    WORKFLOW: { fetch: workflowFetch },
    ARCHIVE_BUCKET: {}
  } as unknown as Env;

  return { env, listUrls, eventPosts, startedIds, workflowFetch };
}

interface SweepSummary {
  dryRun: boolean;
  scanned: number;
  candidates: number;
  retriggered: number;
  skipped: number;
}

async function sweep(env: Env, body: Record<string, unknown>): Promise<SweepSummary> {
  const request = new Request('https://gateway.jayteealao.workers.dev/internal/sweep-orphan-queued', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-API-Key': 'internal-key' },
    body: JSON.stringify(body)
  });
  const response = await gateway.fetch(request, env, {} as ExecutionContext);
  expect(response.status).toBe(200);
  return (await response.json()) as SweepSummary;
}

describe('orphan queued sweep during a burst', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reaches the old stuck rows behind 150 young ones', async () => {
    const { env, listUrls } = createEnv([...youngBurst(), ...stuckRows()]);

    const summary = await sweep(env, { dryRun: true });

    expect(summary.candidates).toBe(5);
    expect(listUrls).toHaveLength(1);
    const params = listUrls[0].searchParams;
    expect(params.get('status')).toBe('queued');
    expect(params.get('events')).toBe('none');
    expect(params.get('order')).toBe('asc');
    expect(params.get('to')).toBe(new Date(NOW - DEFAULT_MIN_AGE_MS).toISOString());
  });

  it('pages past old rows the gateway skips', async () => {
    const { env, listUrls } = createEnv([...urlLessRows(100), ...stuckRows(), ...youngBurst()]);

    const summary = await sweep(env, { dryRun: true });

    expect(summary.candidates).toBe(5);
    expect(summary.scanned).toBe(105);
    expect(listUrls.map((url) => url.searchParams.get('offset'))).toEqual(['0', '100']);
  });

  it('stops after five pages', async () => {
    const { env, listUrls } = createEnv([...urlLessRows(600), ...stuckRows()]);

    const summary = await sweep(env, { dryRun: true, limit: 100 });

    expect(summary.candidates).toBe(0);
    expect(listUrls.map((url) => url.searchParams.get('offset'))).toEqual(['0', '100', '200', '300', '400']);
  });

  it('reports the same candidates in a dry run and changes nothing', async () => {
    const rows = [...youngBurst(), ...stuckRows()];
    const dry = createEnv(rows);
    const real = createEnv(rows);

    const drySummary = await sweep(dry.env, { dryRun: true });
    const realSummary = await sweep(real.env, {});

    expect(drySummary.candidates).toBe(5);
    expect(realSummary.candidates).toBe(5);
    expect(dry.workflowFetch).not.toHaveBeenCalled();
    expect(dry.eventPosts).toEqual([]);
    expect(real.startedIds).toEqual(stuckRows().map((row) => row.requestId));
    expect(realSummary.retriggered).toBe(5);
  });
});
