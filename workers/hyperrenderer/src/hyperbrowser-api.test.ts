import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HyperbrowserApiClient,
  HyperbrowserHttpError,
  HyperbrowserRateLimitError,
} from './hyperbrowser-api.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('HyperbrowserApiClient', () => {
  it('throws HyperbrowserRateLimitError on 429', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'rate limited' }), {
        status: 429,
        headers: {
          'Retry-After': '3',
          'content-type': 'application/json',
        },
      }),
    ) as typeof fetch;

    const client = new HyperbrowserApiClient({
      apiKey: 'test-key',
      baseUrl: 'https://api.hyperbrowser.ai',
      requestTimeoutMs: 1000,
      retries: 0,
    });

    await expect(
      client.startScrape({
        url: 'https://example.com',
        scrapeOptions: { formats: ['html'] },
      }),
    ).rejects.toBeInstanceOf(HyperbrowserRateLimitError);
  });

  it('retries once on 5xx and then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'temporary' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'completed' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HyperbrowserApiClient({
      apiKey: 'test-key',
      baseUrl: 'https://api.hyperbrowser.ai',
      requestTimeoutMs: 1000,
      retries: 1,
    });

    const result = await client.getScrapeStatus('job-1');
    expect(result.status).toBe('completed');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws HyperbrowserHttpError on invalid JSON success response', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('not-json', {
        status: 200,
      }),
    ) as typeof fetch;

    const client = new HyperbrowserApiClient({
      apiKey: 'test-key',
      baseUrl: 'https://api.hyperbrowser.ai',
      requestTimeoutMs: 1000,
      retries: 0,
    });

    await expect(client.getScrapeStatus('job-2')).rejects.toBeInstanceOf(HyperbrowserHttpError);
  });
});
