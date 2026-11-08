import { describe, expect, it, vi } from 'vitest';
import {
  callRenderer,
  callRendererForStep,
  callRendererWith403Fallback,
  callMonolith,
  getRendererFallbackReason,
  isBrowserRendering403ForRender,
  ServiceCallError,
  type ServiceErrorClassification,
} from './services.js';
import { PROXY_ERROR_PAGE_REASON } from '@warg/shared';
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

  it('falls back to hyperrenderer on Browser Rendering network-closed 5006 failures', async () => {
    const rendererFetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeJsonResponse(502, {
          error: 'Browser Rendering /content failed',
          status: 422,
          details: JSON.stringify({
            success: false,
            errors: [{ code: 5006, message: 'browser disconnected' }],
          }),
        }),
      );

    const hyperrendererFetch = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(200, makeRendererSuccess('rendered-hyper-fallback.html')));

    const env = makeEnv(rendererFetch, hyperrendererFetch);

    const outcome = await callRendererWith403Fallback(env, {
      request_id: 'req-2b',
      url: 'https://example.com/fallback-5006',
      browser_quota_kind: 'rest_request',
    });

    expect(outcome.fallbackUsed).toBe(true);
    expect(outcome.fallbackReason).toBe('browser_rendering_5006');
    expect(rendererFetch).toHaveBeenCalledTimes(1);
    expect(hyperrendererFetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to hyperrenderer on Browser Rendering execution-context-destroyed failures', async () => {
    const rendererFetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeJsonResponse(502, {
          error: 'Browser Rendering /content failed',
          status: 500,
          details: JSON.stringify({
            success: false,
            errors: [{ code: 6000, message: 'execution context was destroyed' }],
          }),
        }),
      );

    const hyperrendererFetch = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(200, makeRendererSuccess('rendered-hyper-fallback-6000.html')));

    const env = makeEnv(rendererFetch, hyperrendererFetch);

    const outcome = await callRendererWith403Fallback(env, {
      request_id: 'req-2c',
      url: 'https://example.com/fallback-6000',
      browser_quota_kind: 'rest_request',
    });

    expect(outcome.fallbackUsed).toBe(true);
    expect(outcome.fallbackReason).toBe('browser_rendering_6000');
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

  it('throws service error when renderer returns malformed success payload', async () => {
    const rendererFetch = vi.fn(async () =>
      makeJsonResponse(200, { uses_browser_rendering: true, quota_kind_used: 'rest_request' })
    );
    const hyperrendererFetch = vi.fn();

    const env = makeEnv(rendererFetch, hyperrendererFetch);

    await expect(
      callRendererWith403Fallback(env, {
        request_id: 'req-malformed',
        url: 'https://example.com/malformed',
        browser_quota_kind: 'rest_request',
      }),
    ).rejects.toMatchObject({
      classification: { errorCode: 'RENDER_SERVICE_ERROR' },
    });

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

describe('getRendererFallbackReason', () => {
  it('returns browser_rendering_5006 for wrapped network-closed failures', () => {
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
      JSON.stringify({
        error: 'Browser Rendering /content failed',
        status: 500,
        details: '{"errors":[{"code":5006,"message":"network closed"}]}',
      })
    );

    expect(getRendererFallbackReason(err)).toBe('browser_rendering_5006');
  });

  it('returns browser_rendering_6000 for wrapped context-destroyed failures', () => {
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
      JSON.stringify({
        error: 'Browser Rendering /content failed',
        status: 500,
        details: '{"errors":[{"code":6000,"message":"execution context was destroyed"}]}',
      })
    );

    expect(getRendererFallbackReason(err)).toBe('browser_rendering_6000');
  });
});

describe('proxy error page fallback', () => {
  const proxyErrorBody = {
    error: 'Browser Rendering /content returned a proxy/network error page',
    reason: PROXY_ERROR_PAGE_REASON,
    url: 'https://dead.example.com/post',
  };

  it('maps the renderer proxy-error-page rejection to a fallback reason', () => {
    const err = new ServiceCallError(
      'Service error 502: { ... }',
      { errorCode: 'RENDER_SERVICE_ERROR', retryable: true, recommendedAction: 'retry_step' },
      '/render',
      502,
      JSON.stringify(proxyErrorBody),
    );

    expect(getRendererFallbackReason(err)).toBe('browser_rendering_proxy_error_page');
  });

  it('does not map a 502 payload without the discriminator', () => {
    const err = new ServiceCallError(
      'Service error 502: { ... }',
      { errorCode: 'RENDER_SERVICE_ERROR', retryable: true, recommendedAction: 'retry_step' },
      '/render',
      502,
      JSON.stringify({ error: 'Browser Rendering /content returned invalid response' }),
    );

    expect(getRendererFallbackReason(err)).toBeUndefined();
  });

  it('falls back to hyperrenderer when the renderer rejects a proxy error page', async () => {
    const rendererFetch = vi.fn().mockResolvedValueOnce(makeJsonResponse(502, proxyErrorBody));
    const hyperrendererFetch = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse(200, makeRendererSuccess('rendered-fallback.html')));

    const outcome = await callRendererWith403Fallback(makeEnv(rendererFetch, hyperrendererFetch), {
      request_id: 'req-proxy',
      url: 'https://dead.example.com/post',
      browser_quota_kind: 'rest_request',
    });

    expect(outcome.fallbackUsed).toBe(true);
    expect(outcome.fallbackReason).toBe('browser_rendering_proxy_error_page');
    expect(rendererFetch).toHaveBeenCalledTimes(1);
    expect(hyperrendererFetch).toHaveBeenCalledTimes(1);
  });
});

describe('monolith service classification', () => {
  it('classifies sandbox timeout payloads as MONOLITH_TIMEOUT', async () => {
    const monolithFetch = vi.fn(async () =>
      makeJsonResponse(500, {
        error: 'Internal error',
        message: 'SandboxError: timeout waiting for output',
      }),
    );

    const env = {
      INTERNAL_API_KEY: 'test-internal-key',
      MONOLITH: { fetch: monolithFetch },
    } as unknown as Env;

    await expect(
      callMonolith(env, {
        request_id: 'req-m1',
        rendered_html_key: 'archives/req/raw/rendered.html',
        base_url: 'https://example.com',
      }),
    ).rejects.toMatchObject({
      classification: { errorCode: 'MONOLITH_TIMEOUT', retryable: true },
    });
  });

  it('classifies sandbox HTTP 500 payloads as MONOLITH_SANDBOX_500', async () => {
    const monolithFetch = vi.fn(async () =>
      makeJsonResponse(500, {
        error: 'Internal error',
        message: 'SandboxError: HTTP error! status: 500',
      }),
    );

    const env = {
      INTERNAL_API_KEY: 'test-internal-key',
      MONOLITH: { fetch: monolithFetch },
    } as unknown as Env;

    await expect(
      callMonolith(env, {
        request_id: 'req-m2',
        rendered_html_key: 'archives/req/raw/rendered.html',
        base_url: 'https://example.com',
      }),
    ).rejects.toMatchObject({
      classification: { errorCode: 'MONOLITH_SANDBOX_500', retryable: true },
    });
  });

  it('classifies RPC payload-size failures as MONOLITH_RPC_32MIB_LIMIT', async () => {
    const monolithFetch = vi.fn(async () =>
      makeJsonResponse(500, {
        error: 'Internal error',
        message:
          'Message length too big: found 33640795 bytes, the max allowed message length is 33554432 bytes',
      }),
    );

    const env = {
      INTERNAL_API_KEY: 'test-internal-key',
      MONOLITH: { fetch: monolithFetch },
    } as unknown as Env;

    await expect(
      callMonolith(env, {
        request_id: 'req-m3',
        rendered_html_key: 'archives/req/raw/rendered.html',
        base_url: 'https://example.com',
      }),
    ).rejects.toMatchObject({
      classification: { errorCode: 'MONOLITH_RPC_32MIB_LIMIT', retryable: false },
    });
  });
});

const renderParams = {
  request_id: 'req-classify',
  url: 'https://example.com/article',
  browser_quota_kind: 'rest_request',
} as const;

function wrappedContentFailure(details: string, status = 500): Response {
  return makeJsonResponse(502, { error: 'Browser Rendering /content failed', status, details });
}

async function catchServiceCallError(promise: Promise<unknown>): Promise<ServiceCallError> {
  const error = await promise.then(
    () => undefined,
    (err: unknown) => err,
  );
  if (!(error instanceof ServiceCallError)) {
    throw new Error(`expected a ServiceCallError, got ${String(error)}`);
  }
  return error;
}

async function classifyRendererResponse(response: Response): Promise<ServiceErrorClassification> {
  const rendererFetch = vi.fn(async () => response);
  const env = makeEnv(rendererFetch, vi.fn());
  const error = await catchServiceCallError(callRenderer(env, renderParams));
  return error.classification;
}

describe('render failures that stay retryable', () => {
  it.each([
    ['plain HTTP 503', () => new Response('Service Unavailable', { status: 503 })],
    ['HTTP 502 with a body that is not a Browser Rendering failure', () => makeJsonResponse(502, { error: 'upstream failed' })],
    ['HTTP 429', () => new Response('Too Many Requests', { status: 429 })],
    ['a network-closed 5006 failure', () => wrappedContentFailure('{"errors":[{"code":5006,"message":"network closed"}]}')],
    ['a context-destroyed 6000 failure', () => wrappedContentFailure('{"errors":[{"code":6000}]}')],
    ['a dial that timed out', () => wrappedContentFailure('dial tcp 1.2.3.4:443: i/o timeout')],
    ['a browser timeout error code', () => wrappedContentFailure('net::ERR_TIMED_OUT at https://example.com/article')],
  ])('keeps %s retryable', async (_label, makeResponse) => {
    const classification = await classifyRendererResponse(makeResponse());
    expect(classification.retryable).toBe(true);
  });

  it('keeps a renderer timeout retryable', async () => {
    const rendererFetch = vi.fn(async () => {
      const abort = new Error('The operation was aborted');
      abort.name = 'AbortError';
      throw abort;
    });
    const error = await catchServiceCallError(callRenderer(makeEnv(rendererFetch, vi.fn()), renderParams));
    expect(error.classification).toEqual({
      errorCode: 'RENDER_TIMEOUT',
      retryable: true,
      recommendedAction: 'retry_step',
    });
  });
});

/** Stands in for the runtime's NonRetryableError, which only exists inside Workers. */
class FakeNonRetryableError extends Error {}

/**
 * Records how a workflow step with `retries.limit = limit` runs `fn`: one first
 * attempt plus up to `limit` retries, stopping at once on a non-retryable error.
 */
async function runWithRetries<T>(limit: number, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= limit; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof FakeNonRetryableError) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

function runRenderStep(env: Env): Promise<unknown> {
  return runWithRetries(3, () =>
    callRendererForStep(env, renderParams, (m) => new FakeNonRetryableError(m)),
  );
}

describe('access-blocked render failures', () => {
  it('classifies a wrapped Browser Rendering 403 as not retryable', async () => {
    const classification = await classifyRendererResponse(wrappedContentFailure('forbidden', 403));
    expect(classification).toEqual({
      errorCode: 'ACCESS_BLOCKED',
      retryable: false,
      recommendedAction: 'check_access',
    });
  });

  it('fails the render step after one attempt when the fallback is blocked too', async () => {
    const rendererFetch = vi.fn(async () => wrappedContentFailure('forbidden', 403));
    const hyperrendererFetch = vi.fn(async () => new Response('Forbidden', { status: 403 }));

    await expect(runRenderStep(makeEnv(rendererFetch, hyperrendererFetch))).rejects.toBeInstanceOf(
      FakeNonRetryableError,
    );
    expect(rendererFetch).toHaveBeenCalledTimes(1);
    expect(hyperrendererFetch).toHaveBeenCalledTimes(1);
  });

  it('fails the render step after one attempt on a direct 403, without the fallback', async () => {
    const rendererFetch = vi.fn(async () => new Response('Forbidden', { status: 403 }));
    const hyperrendererFetch = vi.fn();

    await expect(runRenderStep(makeEnv(rendererFetch, hyperrendererFetch))).rejects.toBeInstanceOf(
      FakeNonRetryableError,
    );
    expect(rendererFetch).toHaveBeenCalledTimes(1);
    expect(hyperrendererFetch).not.toHaveBeenCalled();
  });
});
