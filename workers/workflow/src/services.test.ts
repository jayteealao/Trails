import { describe, expect, it, vi } from 'vitest';
import {
  callRendererWith403Fallback,
  isBrowserRendering403ForRender,
  ServiceCallError,
  type ServiceErrorClassification,
} from './services.js';
import type { RendererResponse } from './types.js';

function makeJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

function makeEnv(rendererFetch: ReturnType<typeof vi.fn>, hyperrendererFetch: ReturnType<typeof vi.fn>): Env {
  return {
    INTERNAL_API_KEY: 'test-internal-key',
    RENDERER: { fetch: rendererFetch },
    HYPERRENDERER: { fetch: hyperrendererFetch },
  } as unknown as Env;
}

function makeRendererSuccess(kindSuffix = 'rendered.html'): RendererResponse {
  return {
    uses_browser_rendering: true,
    quota_kind_used: 'rest_request',
    artifacts: [
      {
        kind: 'rendered.html',
        r2Key: `archives/req/raw/${kindSuffix}`,
        bytes: 10,
        sha256: 'abc',
        contentType: 'text/html',
      },
    ],
    meta: {
      skipped: [],
      browserApiMs: 123,
    },
  };
}

describe('renderer 403 fallback', () => {
  it('returns primary renderer result when renderer succeeds', async () => {
    const rendererFetch = vi.fn(async () => makeJsonResponse(200, makeRendererSuccess()));
    const hyperrendererFetch = vi.fn(async () => makeJsonResponse(200, makeRendererSuccess()));

    const env = makeEnv(rendererFetch, hyperrendererFetch);

    const outcome = await callRendererWith403Fallback(env, {
      request_id: 'req-1',
      url: 'https://example.com',
      browser_quota_kind: 'rest_request',
    });

    expect(outcome.fallbackUsed).toBe(false);
    expect(outcome.result.artifacts[0]?.kind).toBe('rendered.html');
    expect(rendererFetch).toHaveBeenCalledTimes(1);
    expect(hyperrendererFetch).toHaveBeenCalledTimes(0);
  });

  it('falls back to hyperrenderer when renderer wraps Browser Rendering 403', async () => {
    const rendererFetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeJsonResponse(502, {
          error: 'Browser Rendering /content failed',
          status: 403,
          details: 'forbidden',
        }),
      );

    const fallbackResponse = makeRendererSuccess('rendered-fallback.html');
    fallbackResponse.meta = {
      skipped: [],
      provider: 'hyperbrowser',
      hyperbrowserJobId: 'job-1',
    };

    const hyperrendererFetch = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(200, fallbackResponse));

    const env = makeEnv(rendererFetch, hyperrendererFetch);

    const outcome = await callRendererWith403Fallback(env, {
      request_id: 'req-2',
      url: 'https://example.com/fallback',
      browser_quota_kind: 'rest_request',
    });

    expect(outcome.fallbackUsed).toBe(true);
    expect(outcome.fallbackReason).toBe('browser_rendering_403');
    expect(outcome.result.meta?.provider).toBe('hyperbrowser');
    expect(rendererFetch).toHaveBeenCalledTimes(1);
    expect(hyperrendererFetch).toHaveBeenCalledTimes(1);
  });

  it('does not fall back for non-qualifying renderer failures', async () => {
    const rendererFetch = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(502, { error: 'Renderer failed', status: 500 }));
    const hyperrendererFetch = vi.fn();

    const env = makeEnv(rendererFetch, hyperrendererFetch);

    await expect(
      callRendererWith403Fallback(env, {
        request_id: 'req-3',
        url: 'https://example.com/no-fallback',
        browser_quota_kind: 'rest_request',
      }),
    ).rejects.toBeInstanceOf(ServiceCallError);

    expect(rendererFetch).toHaveBeenCalledTimes(1);
    expect(hyperrendererFetch).toHaveBeenCalledTimes(0);
  });

  it('throws composed error when fallback also fails', async () => {
    const rendererFetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeJsonResponse(502, {
          error: 'Browser Rendering /content failed',
          status: 403,
          details: 'forbidden',
        }),
      );

    const hyperrendererFetch = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(500, { error: 'Internal error', message: 'upstream fail' }));

    const env = makeEnv(rendererFetch, hyperrendererFetch);

    await expect(
      callRendererWith403Fallback(env, {
        request_id: 'req-4',
        url: 'https://example.com/fallback-fails',
        browser_quota_kind: 'rest_request',
      }),
    ).rejects.toThrow('fallback failed');

    expect(rendererFetch).toHaveBeenCalledTimes(1);
    expect(hyperrendererFetch).toHaveBeenCalledTimes(1);
  });
});

describe('isBrowserRendering403ForRender', () => {
  it('returns false for non-ServiceCallError values', () => {
    expect(isBrowserRendering403ForRender(new Error('x'))).toBe(false);
    expect(isBrowserRendering403ForRender('x')).toBe(false);
  });

  it('returns false when response body is not parseable JSON', () => {
    const classification: ServiceErrorClassification = {
      errorCode: 'RENDER_SERVICE_ERROR',
      retryable: true,
      recommendedAction: 'retry_step',
    };

    const err = new ServiceCallError(
      'Service error 502: not json',
      classification,
      '/render',
      502,
      'not-json'
    );

    expect(isBrowserRendering403ForRender(err)).toBe(false);
  });

  it('returns true for wrapped Browser Rendering 403 payload', () => {
    const classification: ServiceErrorClassification = {
      errorCode: 'RENDER_SERVICE_ERROR',
      retryable: true,
      recommendedAction: 'retry_step',
    };

    const err = new ServiceCallError(
      'Service error 502: { ... }',
      classification,
      '/render',
      502,
      JSON.stringify({ error: 'Browser Rendering /content failed', status: 403, details: 'Forbidden' })
    );

    expect(isBrowserRendering403ForRender(err)).toBe(true);
  });

  it('returns true when renderer returns direct 403 payload shape', () => {
    const classification: ServiceErrorClassification = {
      errorCode: 'ACCESS_BLOCKED',
      retryable: false,
      recommendedAction: 'check_access',
    };

    const err = new ServiceCallError(
      'Service error 403: { ... }',
      classification,
      '/render',
      403,
      JSON.stringify({ error: 'Browser Rendering /content failed', status: 403, details: 'Forbidden' })
    );

    expect(isBrowserRendering403ForRender(err)).toBe(true);
  });
});
