import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock helpers ---

function createMockFetcher(handler: (input: any, init?: RequestInit) => Promise<Response>) {
  return { fetch: vi.fn(handler) };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(text: string, status: number): Response {
  return new Response(text, { status });
}

function createRequest(url: string, options?: RequestInit): Request {
  return new Request(url, options);
}

function mockCall(fetchMock: { mock: { calls: unknown[][] } }, index = 0): [any, any] {
  return (fetchMock.mock.calls[index] ?? []) as [any, any];
}

// --- Stats proxy ---

describe('stats proxy', () => {
  it('forwards to LOGGER service binding with correct path and API key', async () => {
    const mockLogger = createMockFetcher(async () => jsonResponse({ total: 42 }));
    const env = { LOGGER: mockLogger, INTERNAL_API_KEY: 'test-key' } as any;

    const { onRequestGet } = await import('../stats.js');
    const request = createRequest('https://dashboard.example.com/api/stats');

    const response = await onRequestGet({ env, request, params: {} } as any);
    const data = (await response.json()) as { total: number };

    expect(data).toEqual({ total: 42 });
    expect(mockLogger.fetch).toHaveBeenCalledOnce();

    const [url, init] = mockCall(mockLogger.fetch);
    expect(url).toBe('https://logger/stats');
    expect((init.headers as Record<string, string>)['X-Internal-API-Key']).toBe('test-key');
  });

  it('returns error response when logger fails', async () => {
    const mockLogger = createMockFetcher(async () => errorResponse('Internal error', 500));
    const env = { LOGGER: mockLogger, INTERNAL_API_KEY: 'test-key' } as any;

    const { onRequestGet } = await import('../stats.js');
    const request = createRequest('https://dashboard.example.com/api/stats');

    const response = await onRequestGet({ env, request, params: {} } as any);

    expect(response.status).toBe(500);
    const data = (await response.json()) as { error: string };
    expect(data.error).toContain('Internal error');
  });
});

// --- Requests proxy ---

describe('requests proxy', () => {
  it('forwards query params to logger service binding', async () => {
    const mockLogger = createMockFetcher(async () => jsonResponse({ requests: [] }));
    const env = { LOGGER: mockLogger, INTERNAL_API_KEY: 'key' } as any;

    const { onRequestGet } = await import('../requests.js');
    const request = createRequest('https://dashboard.example.com/api/requests?domain=example.com&status=done&q=test&from=2026-01-01&to=2026-02-01&limit=10&offset=5');

    await onRequestGet({ env, request, params: {} } as any);

    const [url] = mockCall(mockLogger.fetch);
    const parsedUrl = new URL(url);
    expect(parsedUrl.pathname).toBe('/requests');
    expect(parsedUrl.searchParams.get('domain')).toBe('example.com');
    expect(parsedUrl.searchParams.get('status')).toBe('done');
    expect(parsedUrl.searchParams.get('q')).toBe('test');
    expect(parsedUrl.searchParams.get('from')).toBe('2026-01-01');
    expect(parsedUrl.searchParams.get('to')).toBe('2026-02-01');
    expect(parsedUrl.searchParams.get('limit')).toBe('10');
    expect(parsedUrl.searchParams.get('offset')).toBe('5');
  });

  it('omits unset query params', async () => {
    const mockLogger = createMockFetcher(async () => jsonResponse({ requests: [] }));
    const env = { LOGGER: mockLogger, INTERNAL_API_KEY: 'key' } as any;

    const { onRequestGet } = await import('../requests.js');
    const request = createRequest('https://dashboard.example.com/api/requests');

    await onRequestGet({ env, request, params: {} } as any);

    const [url] = mockCall(mockLogger.fetch);
    const parsedUrl = new URL(url);
    expect(parsedUrl.searchParams.has('domain')).toBe(false);
    expect(parsedUrl.searchParams.has('status')).toBe(false);
  });
});

// --- Request detail proxy ---

describe('[id] proxy', () => {
  it('forwards request ID in path', async () => {
    const mockLogger = createMockFetcher(async () => jsonResponse({ requestId: 'abc123' }));
    const env = { LOGGER: mockLogger, INTERNAL_API_KEY: 'key' } as any;

    const { onRequestGet } = await import('../[id].js');
    const request = createRequest('https://dashboard.example.com/api/abc123');

    await onRequestGet({ env, request, params: { id: 'abc123' } } as any);

    const [url] = mockCall(mockLogger.fetch);
    expect(url).toBe('https://logger/request/abc123');
  });

  it('returns 400 for missing request ID', async () => {
    const mockLogger = createMockFetcher(async () => jsonResponse({}));
    const env = { LOGGER: mockLogger, INTERNAL_API_KEY: 'key' } as any;

    const { onRequestGet } = await import('../[id].js');
    const request = createRequest('https://dashboard.example.com/api/');

    const response = await onRequestGet({ env, request, params: {} } as any);
    expect(response.status).toBe(400);
  });
});

// --- Begin proxy ---

describe('begin proxy', () => {
  it('POSTs to gateway service binding with body', async () => {
    const mockGateway = createMockFetcher(async () => jsonResponse({ requestId: 'new-id' }));
    const env = { GATEWAY: mockGateway, PUBLIC_API_KEY: 'pub-key' } as any;

    const { onRequestPost } = await import('../begin.js');
    const request = createRequest('https://dashboard.example.com/api/begin', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await onRequestPost({ env, request, params: {} } as any);
    const data = (await response.json()) as { requestId: string };

    expect(data.requestId).toBe('new-id');

    const [url, init] = mockCall(mockGateway.fetch);
    expect(url).toBe('https://gateway/begin');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('pub-key');
    expect(JSON.parse(init.body)).toEqual({ url: 'https://example.com' });
  });
});

// --- SSE stream proxy ---

describe('stream/[id] proxy', () => {
  it('forwards request ID and returns SSE content-type', async () => {
    const sseBody = new ReadableStream();
    const mockLogger = createMockFetcher(async () =>
      new Response(sseBody, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    );
    const env = { LOGGER: mockLogger, INTERNAL_API_KEY: 'key' } as any;

    const { onRequestGet } = await import('../stream/[id].js');
    const request = createRequest('https://dashboard.example.com/api/stream/abc123');

    const response = await onRequestGet({ env, request, params: { id: 'abc123' } } as any);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');

    const [url] = mockCall(mockLogger.fetch);
    expect(url).toBe('https://logger/request/abc123/stream');
  });

  it('forwards Last-Event-ID header for reconnection', async () => {
    const mockLogger = createMockFetcher(async () =>
      new Response(new ReadableStream(), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    );
    const env = { LOGGER: mockLogger, INTERNAL_API_KEY: 'key' } as any;

    const { onRequestGet } = await import('../stream/[id].js');
    const request = createRequest('https://dashboard.example.com/api/stream/abc123', {
      headers: { 'Last-Event-ID': '42' },
    });

    await onRequestGet({ env, request, params: { id: 'abc123' } } as any);

    const [, init] = mockCall(mockLogger.fetch);
    expect(init.headers['Last-Event-ID']).toBe('42');
  });

  it('returns 404 when logger reports not found', async () => {
    const mockLogger = createMockFetcher(async () =>
      errorResponse('{"error":"Request not found"}', 404)
    );
    const env = { LOGGER: mockLogger, INTERNAL_API_KEY: 'key' } as any;

    const { onRequestGet } = await import('../stream/[id].js');
    const request = createRequest('https://dashboard.example.com/api/stream/missing');

    const response = await onRequestGet({ env, request, params: { id: 'missing' } } as any);

    expect(response.status).toBe(404);
  });

  it('returns 400 for missing request ID', async () => {
    const mockLogger = createMockFetcher(async () => jsonResponse({}));
    const env = { LOGGER: mockLogger, INTERNAL_API_KEY: 'key' } as any;

    const { onRequestGet } = await import('../stream/[id].js');
    const request = createRequest('https://dashboard.example.com/api/stream/');

    const response = await onRequestGet({ env, request, params: {} } as any);
    expect(response.status).toBe(400);
  });
});

// --- Batch proxy ---

describe('batch proxy', () => {
  it('POSTs to logger service binding', async () => {
    const mockLogger = createMockFetcher(async () => jsonResponse({ requests: [{ requestId: 'a' }] }));
    const env = { LOGGER: mockLogger, INTERNAL_API_KEY: 'key' } as any;

    const { onRequestPost } = await import('../batch.js');
    const request = createRequest('https://dashboard.example.com/api/batch', {
      method: 'POST',
      body: JSON.stringify({ requestIds: ['a', 'b'] }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await onRequestPost({ env, request, params: {} } as any);
    const data = (await response.json()) as { requests: Array<{ requestId: string }> };

    expect(data.requests).toHaveLength(1);

    const [url, init] = mockCall(mockLogger.fetch);
    expect(url).toBe('https://logger/requests/batch');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Internal-API-Key']).toBe('key');
  });
});

// --- Inbox API ---

describe('inbox proxy', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('merges logger + dashboard api results into inbox payload', async () => {
    const mockLogger = createMockFetcher(async () => jsonResponse({
      requests: [{ requestId: 'r1', url: 'https://a.com', stage: 'failed' }],
    }));
    const env = {
      LOGGER: mockLogger,
      DASHBOARD_API_URL: 'https://dashboard-api.example.com',
      INTERNAL_API_KEY: 'internal-key',
    } as any;

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input);
      const parsed = new URL(url);
      const filter = parsed.searchParams.get('filter');
      if (filter === 'failed') return jsonResponse({ articles: [{ item_id: 'a1' }] });
      if (filter === 'incomplete') return jsonResponse({ articles: [{ item_id: 'a2' }] });
      if (filter === 'processing') return jsonResponse({ articles: [{ item_id: 'a3' }] });
      return jsonResponse({ articles: [{ item_id: 'a4', created_at: new Date().toISOString() }] });
    });

    const { onRequestGet } = await import('../inbox.js');
    const request = createRequest('https://dashboard.example.com/api/inbox');
    const response = await onRequestGet({ env, request, params: {} } as any);
    const data = (await response.json()) as {
      needsAttention: {
        failedRequests: unknown[];
        failedArticles: unknown[];
        incompleteArticles: unknown[];
      };
      inProgress: { processingArticles: unknown[] };
    };

    expect(response.status).toBe(200);
    expect(data.needsAttention.failedRequests).toHaveLength(1);
    expect(data.needsAttention.failedArticles).toHaveLength(1);
    expect(data.needsAttention.incompleteArticles).toHaveLength(1);
    expect(data.inProgress.processingArticles).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalled();
  });
});

// --- Article retry endpoints ---

describe('article retry endpoints', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('retry-missing derives step list and submits to gateway', async () => {
    const mockGateway = createMockFetcher(async () => jsonResponse({ requestId: 'abc123' }));
    const env = {
      GATEWAY: mockGateway,
      DASHBOARD_API_URL: 'https://dashboard-api.example.com',
      INTERNAL_API_KEY: 'internal-key',
      PUBLIC_API_KEY: 'public-key',
    } as any;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse({
        item_id: 'abc123',
        url: 'https://example.com',
        archives: [
          { key: 'rendered', status: 'failed' },
          { key: 'singlefile', status: 'success' },
          { key: 'markdown', status: 'absent' },
        ],
      })
    );

    const { onRequestPost } = await import('../articles/[itemId]/retry-missing.js');
    const request = createRequest('https://dashboard.example.com/api/articles/abc123/retry-missing', {
      method: 'POST',
    });

    const response = await onRequestPost({
      env,
      request,
      params: { itemId: 'abc123' },
    } as any);
    const body = (await response.json()) as { submitted: boolean };

    expect(response.status).toBe(200);
    expect(body.submitted).toBe(true);
    const [, init] = mockCall(mockGateway.fetch);
    const payload = JSON.parse(init.body);
    expect(payload.steps).toEqual(expect.arrayContaining(['render', 'readability']));
  });

  it('retry-step forwards chosen step', async () => {
    const mockGateway = createMockFetcher(async () => jsonResponse({ requestId: 'abc123' }));
    const env = {
      GATEWAY: mockGateway,
      DASHBOARD_API_URL: 'https://dashboard-api.example.com',
      INTERNAL_API_KEY: 'internal-key',
      PUBLIC_API_KEY: 'public-key',
    } as any;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse({
        item_id: 'abc123',
        url: 'https://example.com',
        archives: [],
      })
    );

    const { onRequestPost } = await import('../articles/[itemId]/retry-step.js');
    const request = createRequest('https://dashboard.example.com/api/articles/abc123/retry-step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 'monolith' }),
    });

    const response = await onRequestPost({
      env,
      request,
      params: { itemId: 'abc123' },
    } as any);
    const body = (await response.json()) as { steps: string[] };

    expect(response.status).toBe(200);
    expect(body.steps).toEqual(['monolith']);
  });

  it('retry-full returns clear config error when PUBLIC_API_KEY is missing', async () => {
    const mockGateway = createMockFetcher(async () => jsonResponse({ requestId: 'abc123' }));
    const env = {
      GATEWAY: mockGateway,
      DASHBOARD_API_URL: 'https://dashboard-api.example.com',
      INTERNAL_API_KEY: 'internal-key',
      PUBLIC_API_KEY: '',
    } as any;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse({
        item_id: 'abc123',
        url: 'https://example.com',
        archives: [],
      })
    );

    const { onRequestPost } = await import('../articles/[itemId]/retry-full.js');
    const request = createRequest('https://dashboard.example.com/api/articles/abc123/retry-full', {
      method: 'POST',
    });

    const response = await onRequestPost({
      env,
      request,
      params: { itemId: 'abc123' },
    } as any);
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(500);
    expect(String(body.error || '')).toContain('PUBLIC_API_KEY');
    expect(mockGateway.fetch).not.toHaveBeenCalled();
  });
});

// --- Archive content proxy ---

describe('archive-content proxy', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches signed url via dashboard-api and streams archive bytes', async () => {
    const env = {
      DASHBOARD_API_URL: 'https://dashboard-api.example.com',
      INTERNAL_API_KEY: 'internal-key',
    } as any;

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.startsWith('https://dashboard-api.example.com/signed-url')) {
        return jsonResponse({
          url: 'https://signed.example.com/archive',
          archive_source_key: 'readability_json',
        });
      }
      if (url === 'https://signed.example.com/archive') {
        return new Response('archive-content', {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
      return errorResponse('Unexpected URL', 500);
    });

    const { onRequestGet } = await import('../archive-content.js');
    const request = createRequest(
      'https://dashboard.example.com/api/archive-content?itemId=abc12345&archiveKey=readability'
    );

    const response = await onRequestGet({ env, request, params: {} } as any);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('archive-content');
    expect(response.headers.get('X-Archive-Source-Key')).toBe('readability_json');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns 500 when INTERNAL_API_KEY is not configured', async () => {
    const env = {
      DASHBOARD_API_URL: 'https://dashboard-api.example.com',
      INTERNAL_API_KEY: '',
    } as any;

    const { onRequestGet } = await import('../archive-content.js');
    const request = createRequest(
      'https://dashboard.example.com/api/archive-content?itemId=abc12345&archiveKey=markdown'
    );

    const response = await onRequestGet({ env, request, params: {} } as any);
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error?: string };
    expect(String(body.error || '')).toContain('INTERNAL_API_KEY');
  });
});
