import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock helpers ---

function createMockFetcher(handler: (input: RequestInfo, init?: RequestInit) => Promise<Response>) {
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

// --- Stats proxy ---

describe('stats proxy', () => {
  it('forwards to LOGGER service binding with correct path and API key', async () => {
    const mockLogger = createMockFetcher(async () => jsonResponse({ total: 42 }));
    const env = { LOGGER: mockLogger, INTERNAL_API_KEY: 'test-key' } as any;

    const { onRequestGet } = await import('../stats.js');
    const request = createRequest('https://dashboard.example.com/api/stats');

    const response = await onRequestGet({ env, request, params: {} } as any);
    const data = await response.json();

    expect(data).toEqual({ total: 42 });
    expect(mockLogger.fetch).toHaveBeenCalledOnce();

    const [url, init] = mockLogger.fetch.mock.calls[0];
    expect(url).toBe('https://logger/stats');
    expect(init.headers['X-Internal-API-Key']).toBe('test-key');
  });

  it('returns error response when logger fails', async () => {
    const mockLogger = createMockFetcher(async () => errorResponse('Internal error', 500));
    const env = { LOGGER: mockLogger, INTERNAL_API_KEY: 'test-key' } as any;

    const { onRequestGet } = await import('../stats.js');
    const request = createRequest('https://dashboard.example.com/api/stats');

    const response = await onRequestGet({ env, request, params: {} } as any);

    expect(response.status).toBe(500);
    const data = await response.json();
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

    const [url] = mockLogger.fetch.mock.calls[0];
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

    const [url] = mockLogger.fetch.mock.calls[0];
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

    const [url] = mockLogger.fetch.mock.calls[0];
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
    const data = await response.json();

    expect(data.requestId).toBe('new-id');

    const [url, init] = mockGateway.fetch.mock.calls[0];
    expect(url).toBe('https://gateway/begin');
    expect(init.method).toBe('POST');
    expect(init.headers['X-API-Key']).toBe('pub-key');
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

    const [url] = mockLogger.fetch.mock.calls[0];
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

    const [, init] = mockLogger.fetch.mock.calls[0];
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
    const data = await response.json();

    expect(data.requests).toHaveLength(1);

    const [url, init] = mockLogger.fetch.mock.calls[0];
    expect(url).toBe('https://logger/requests/batch');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Internal-API-Key']).toBe('key');
  });
});
