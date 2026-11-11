import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';

// The handler takes its own env shape (with its secrets), not the generated one.
type HandlerEnv = Parameters<typeof worker.fetch>[1];

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function envWith(vars: Record<string, string> = {}): HandlerEnv {
  const bucket = { get: vi.fn(), put: vi.fn(async () => undefined), head: vi.fn() };
  return {
    INTERNAL_API_KEY: 'test-key',
    HYPERBROWSER_API_KEY: 'hb-key',
    HYPERBROWSER_POLL_INTERVAL_MS: '1',
    ARCHIVE_BUCKET: bucket,
    ...vars,
  } as unknown as HandlerEnv;
}

/** Fakes the Hyperbrowser scrape API and keeps the body of the scrape start request. */
function fakeHyperbrowser(): { scrapeBodies: unknown[] } {
  const scrapeBodies: unknown[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname } = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (method === 'POST' && pathname === '/api/scrape') {
      scrapeBodies.push(JSON.parse(String(init?.body)));
      return Response.json({ jobId: 'job-1' });
    }
    if (method === 'GET' && pathname === '/api/scrape/job-1/status') {
      return Response.json({ status: 'completed' });
    }
    if (method === 'GET' && pathname === '/api/scrape/job-1') {
      return Response.json({
        jobId: 'job-1',
        status: 'completed',
        data: { html: '<html><body><p>An article</p></body></html>' },
      });
    }
    return new Response('unexpected request', { status: 500 });
  }) as typeof fetch;
  return { scrapeBodies };
}

function renderRequest(): Request {
  return new Request('https://hyperrenderer/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-API-Key': 'test-key' },
    body: JSON.stringify({
      request_id: 'req-1',
      url: 'https://example.com/a',
      browser_quota_kind: 'rest_request',
    }),
  });
}

describe('fallback render session and meta', () => {
  it('renders without stealth when no setting is given and reports it', async () => {
    const { scrapeBodies } = fakeHyperbrowser();

    const res = await worker.fetch(renderRequest(), envWith());
    const body = (await res.json()) as { meta: { stealth: string; provider: string } };

    expect(res.status).toBe(200);
    expect(scrapeBodies).toHaveLength(1);
    expect((scrapeBodies[0] as { sessionOptions: object }).sessionOptions).toEqual({});
    expect(body.meta.stealth).toBe('none');
    expect(body.meta.provider).toBe('hyperbrowser');
  });

  it('uses stealth when a person opts in with auto and reports it', async () => {
    const { scrapeBodies } = fakeHyperbrowser();

    const res = await worker.fetch(renderRequest(), envWith({ HYPERBROWSER_STEALTH: 'auto' }));
    const body = (await res.json()) as { meta: { stealth: string } };

    expect(res.status).toBe(200);
    expect((scrapeBodies[0] as { sessionOptions: object }).sessionOptions).toEqual({ useStealth: true });
    expect(body.meta.stealth).toBe('auto');
  });

  it('names the stealth setting in a failure answer', async () => {
    globalThis.fetch = vi.fn(async () => new Response('upstream down', { status: 503 })) as typeof fetch;

    const res = await worker.fetch(renderRequest(), envWith({ HYPERBROWSER_STEALTH: 'ultra' }));
    const body = (await res.json()) as { stealth: string };

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(body.stealth).toBe('ultra');
  });
});
