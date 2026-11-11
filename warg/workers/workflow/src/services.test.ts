import { describe, expect, it, vi } from 'vitest';
import {
  callRenderer,
  callRendererForStep,
  callRendererWith403Fallback,
  readRenderFallbackFailure,
  callMonolith,
  callMonolithForStep,
  monolithRetryDelayMs,
  callSinglefile,
  callSinglefileForStep,
  getRendererFallbackReason,
  isBrowserRendering403ForRender,
  ServiceCallError,
  type ServiceErrorClassification,
} from './services.js';
import { BROWSER_TOKEN_INVALID_REASON, PROXY_ERROR_PAGE_REASON, readClassificationTag } from '@warg/shared';
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
    detail: 'dial tcp: lookup www.explorminate.net on 1.1.1.1:53: no such host',
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

describe('rejected credentials', () => {
  function tokenRejectedBody(status: number, named: boolean = true) {
    return {
      error: 'Browser Rendering /content failed',
      status,
      details: '{"errors":[{"code":10000,"message":"Authentication error"}]}',
      ...(named ? { reason: BROWSER_TOKEN_INVALID_REASON } : {}),
    };
  }

  function renderError(body: unknown): ServiceCallError {
    return new ServiceCallError(
      'Service error 502: { ... }',
      { errorCode: 'RENDER_SERVICE_ERROR', retryable: true, recommendedAction: 'retry_step' },
      '/render',
      502,
      JSON.stringify(body),
    );
  }

  it('falls back from a 403 that names the retired token reason as any Browser Rendering 403', () => {
    expect(getRendererFallbackReason(renderError(tokenRejectedBody(403)))).toBe('browser_rendering_403');
  });

  it('gives no fallback for a token rejected with HTTP 401', () => {
    expect(getRendererFallbackReason(renderError(tokenRejectedBody(401)))).toBeUndefined();
  });

  it('keeps the 403 fallback reason of a payload without the token reason', () => {
    expect(getRendererFallbackReason(renderError(tokenRejectedBody(403, false)))).toBe('browser_rendering_403');
  });

  it('classifies a renderer answer that names a rejected token as BROWSER_TOKEN_INVALID', async () => {
    const rendererFetch = vi.fn().mockResolvedValueOnce(makeJsonResponse(502, tokenRejectedBody(401)));
    const hyperrendererFetch = vi.fn();

    await expect(
      callRendererWith403Fallback(makeEnv(rendererFetch, hyperrendererFetch), {
        request_id: 'req-token',
        url: 'https://example.com/post',
        browser_quota_kind: 'rest_request',
      }),
    ).rejects.toMatchObject({
      classification: { errorCode: 'BROWSER_TOKEN_INVALID', retryable: false, recommendedAction: 'check_api_key' },
    });
    expect(hyperrendererFetch).not.toHaveBeenCalled();
  });

  it('classifies a monolith answer that names a refused R2 handler request under its own code', async () => {
    const monolithFetch = vi.fn(async () =>
      makeJsonResponse(502, {
        error: 'Internal error',
        message: 'R2 handler answered 403: curl: (22) The requested URL returned error: 403',
        code: 'MONOLITH_R2_HANDLER_FAILED',
        retryable: false,
      }),
    );

    const env = {
      INTERNAL_API_KEY: 'test-internal-key',
      MONOLITH: { fetch: monolithFetch },
    } as unknown as Env;

    await expect(
      callMonolith(env, {
        request_id: 'req-m4',
        rendered_html_key: 'archives/req/raw/rendered.html',
        base_url: 'https://example.com',
      }),
    ).rejects.toMatchObject({
      classification: {
        errorCode: 'MONOLITH_R2_HANDLER_FAILED',
        retryable: false,
        recommendedAction: 'investigate_service',
      },
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

describe('render failures from a host that cannot be reached', () => {
  const proxyErrorPageBody = {
    error: 'Browser Rendering /content returned a proxy/network error page',
    reason: PROXY_ERROR_PAGE_REASON,
    detail: 'dial tcp: lookup www.explorminate.net on 1.1.1.1:53: no such host',
    url: 'https://www.explorminate.net/post',
  };

  it('classifies the proxy error page rejection as not retryable', async () => {
    const classification = await classifyRendererResponse(makeJsonResponse(502, proxyErrorPageBody));
    expect(classification.retryable).toBe(false);
  });

  it.each([
    'dial tcp 1.2.3.4:443: i/o timeout',
    'read tcp 10.0.0.1:5000->1.2.3.4:443: connection reset by peer',
  ])('keeps a proxy error page that reads "%s" retryable', async (detail) => {
    const classification = await classifyRendererResponse(
      makeJsonResponse(502, { ...proxyErrorPageBody, detail }),
    );
    expect(classification.retryable).toBe(true);
  });

  it('keeps a dial error with no dead-host cause retryable', async () => {
    const classification = await classifyRendererResponse(
      wrappedContentFailure('dial tcp 1.2.3.4:443: some new failure'),
    );
    expect(classification.retryable).toBe(true);
  });

  it.each([
    'dial tcp: lookup www.explorminate.net on 1.1.1.1:53: no such host',
    'net::ERR_NAME_NOT_RESOLVED at https://www.explorminate.net/post',
    'net::ERR_CONNECTION_REFUSED at https://www.explorminate.net/post',
    'dial tcp 1.2.3.4:443: connect: connection refused',
  ])('classifies "%s" as not retryable', async (details) => {
    const classification = await classifyRendererResponse(wrappedContentFailure(details));
    expect(classification).toEqual({
      errorCode: 'RENDER_SERVICE_ERROR',
      retryable: false,
      recommendedAction: 'inspect_url',
    });
  });

  it('fails the render step after one attempt', async () => {
    const rendererFetch = vi.fn(async () =>
      wrappedContentFailure('dial tcp: lookup www.explorminate.net on 1.1.1.1:53: no such host'),
    );
    const hyperrendererFetch = vi.fn();

    await expect(runRenderStep(makeEnv(rendererFetch, hyperrendererFetch))).rejects.toBeInstanceOf(
      FakeNonRetryableError,
    );
    expect(rendererFetch).toHaveBeenCalledTimes(1);
  });
});

const singlefileParams = { request_id: 'req-singlefile', url: 'https://www.explorminate.net/post' };

function makeSinglefileEnv(singlefileFetch: ReturnType<typeof vi.fn>): Env {
  return {
    INTERNAL_API_KEY: 'test-internal-key',
    SINGLEFILE: { fetch: singlefileFetch },
  } as unknown as Env;
}

function runSinglefileStep(env: Env): Promise<unknown> {
  return runWithRetries(3, () =>
    callSinglefileForStep(env, singlefileParams, (m) => new FakeNonRetryableError(m)),
  );
}

describe('singlefile proxy error page rejections', () => {
  const singlefileProxyErrorBody = {
    error: 'SingleFile capture returned a proxy/network error page',
    reason: PROXY_ERROR_PAGE_REASON,
    detail: 'dial tcp: lookup www.explorminate.net on 1.1.1.1:53: no such host',
    url: 'https://www.explorminate.net/post',
  };

  it('classifies the rejection as not retryable', async () => {
    const singlefileFetch = vi.fn(async () => makeJsonResponse(502, singlefileProxyErrorBody));

    const error = await catchServiceCallError(callSinglefile(makeSinglefileEnv(singlefileFetch), singlefileParams));
    expect(error.classification).toEqual({
      errorCode: 'SINGLEFILE_SERVICE_ERROR',
      retryable: false,
      recommendedAction: 'inspect_url',
    });
  });

  it('keeps a capture of a timed-out proxy error page retryable', async () => {
    const singlefileFetch = vi.fn(async () =>
      makeJsonResponse(502, { ...singlefileProxyErrorBody, detail: 'dial tcp 1.2.3.4:443: i/o timeout' }),
    );

    const error = await catchServiceCallError(callSinglefile(makeSinglefileEnv(singlefileFetch), singlefileParams));
    expect(error.classification.retryable).toBe(true);
  });

  it('fails the singlefile step after one attempt, naming the reason', async () => {
    const singlefileFetch = vi.fn(async () => makeJsonResponse(502, singlefileProxyErrorBody));

    const failure = await runSinglefileStep(makeSinglefileEnv(singlefileFetch)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(FakeNonRetryableError);
    expect(failure instanceof Error ? failure.message : '').toContain(PROXY_ERROR_PAGE_REASON);
    expect(singlefileFetch).toHaveBeenCalledTimes(1);
  });

  it('carries its classification in the message of the step failure', async () => {
    const singlefileFetch = vi.fn(async () => makeJsonResponse(502, singlefileProxyErrorBody));

    const failure = await runSinglefileStep(makeSinglefileEnv(singlefileFetch)).catch((error: unknown) => error);
    expect(readClassificationTag(failure instanceof Error ? failure.message : '')).toEqual({
      errorCode: 'SINGLEFILE_SERVICE_ERROR',
      retryable: false,
      recommendedAction: 'inspect_url',
    });
  });
});

describe('singlefile failures that keep retrying', () => {
  it('runs every attempt on a singlefile worker that keeps answering 503', async () => {
    const singlefileFetch = vi.fn(async () => new Response('Service Unavailable', { status: 503 }));

    const error = await catchServiceCallError(runSinglefileStep(makeSinglefileEnv(singlefileFetch)));
    expect(error.classification.retryable).toBe(true);
    expect(singlefileFetch).toHaveBeenCalledTimes(4);
  });

  it('runs every attempt on a recoverable edge-case failure', async () => {
    const singlefileFetch = vi.fn(async () =>
      makeJsonResponse(422, {
        error: 'SingleFile edge-case failure',
        details: 'trustedTypes is not defined',
        recoverable: true,
      }),
    );

    const error = await catchServiceCallError(runSinglefileStep(makeSinglefileEnv(singlefileFetch)));
    expect(error.classification).toEqual({
      errorCode: 'SINGLEFILE_EDGE_CASE',
      retryable: true,
      recommendedAction: 'retry_step',
    });
    expect(singlefileFetch).toHaveBeenCalledTimes(4);
  });

  it('runs every attempt on a capture that came back too short', async () => {
    const singlefileFetch = vi.fn(async () =>
      makeJsonResponse(502, { error: 'SingleFile capture failed: content too short', length: 12 }),
    );

    const error = await catchServiceCallError(runSinglefileStep(makeSinglefileEnv(singlefileFetch)));
    expect(error.classification.retryable).toBe(true);
    expect(singlefileFetch).toHaveBeenCalledTimes(4);
  });
});

describe('transient render failures keep the step retry policy', () => {
  it('runs every attempt on a renderer that keeps answering 503', async () => {
    const rendererFetch = vi.fn(async () => new Response('Service Unavailable', { status: 503 }));
    const hyperrendererFetch = vi.fn();

    const error = await catchServiceCallError(runRenderStep(makeEnv(rendererFetch, hyperrendererFetch)));
    expect(error.classification.retryable).toBe(true);
    expect(rendererFetch).toHaveBeenCalledTimes(4);
    expect(hyperrendererFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['network-closed 5006', '{"errors":[{"code":5006,"message":"network closed"}]}'],
    ['context-destroyed 6000', '{"errors":[{"code":6000}]}'],
  ])('runs every attempt on a %s failure whose fallback answers 503', async (_label, details) => {
    const rendererFetch = vi.fn(async () => wrappedContentFailure(details));
    const hyperrendererFetch = vi.fn(async () => new Response('Service Unavailable', { status: 503 }));

    const error = await catchServiceCallError(runRenderStep(makeEnv(rendererFetch, hyperrendererFetch)));
    expect(error.classification.retryable).toBe(true);
    expect(rendererFetch).toHaveBeenCalledTimes(4);
    expect(hyperrendererFetch).toHaveBeenCalledTimes(4);
  });
});

describe('render fallback stays narrow', () => {
  async function fallbackReasonOf(response: Response): Promise<unknown> {
    const env = makeEnv(vi.fn(async () => response), vi.fn());
    return getRendererFallbackReason(await catchServiceCallError(callRenderer(env, renderParams)));
  }

  it('does not fall back on a dial that timed out', async () => {
    expect(await fallbackReasonOf(wrappedContentFailure('dial tcp 1.2.3.4:443: i/o timeout'))).toBeUndefined();
  });

  it('does not fall back on a failure that does not name an unreachable host', async () => {
    expect(await fallbackReasonOf(wrappedContentFailure('upstream exploded', 500))).toBeUndefined();
  });

  it('keeps the network-closed reason when the details also name an unknown host', async () => {
    const details = '{"errors":[{"code":5006,"message":"network closed"}]} no such host';
    expect(await fallbackReasonOf(wrappedContentFailure(details))).toBe('browser_rendering_5006');
  });
});

describe('fallback for access-blocked and unreachable pages', () => {
  function makeHyperrendererSuccess(): RendererResponse {
    const success = makeRendererSuccess('rendered-fallback.html');
    return { ...success, meta: { skipped: [], provider: 'hyperbrowser' } };
  }

  it('renders an access-blocked page through the hyperrenderer exactly once', async () => {
    const rendererFetch = vi.fn(async () => wrappedContentFailure('forbidden', 403));
    const hyperrendererFetch = vi.fn(async () => makeJsonResponse(200, makeHyperrendererSuccess()));

    const outcome = await runRenderStep(makeEnv(rendererFetch, hyperrendererFetch));

    expect(outcome).toMatchObject({
      fallbackUsed: true,
      fallbackReason: 'browser_rendering_403',
      result: { artifacts: [{ r2Key: 'archives/req/raw/rendered-fallback.html' }], meta: { provider: 'hyperbrowser' } },
    });
    expect(rendererFetch).toHaveBeenCalledTimes(1);
    expect(hyperrendererFetch).toHaveBeenCalledTimes(1);
  });
});

describe('fallback for a host the primary renderer cannot reach', () => {
  it.each([
    'dial tcp: lookup www.explorminate.net on 1.1.1.1:53: no such host',
    'net::ERR_NAME_NOT_RESOLVED at https://www.explorminate.net/post',
    'dial tcp 1.2.3.4:443: connect: connection refused',
  ])('renders "%s" through the hyperrenderer once, without retrying the primary', async (details) => {
    const rendererFetch = vi.fn(async () => wrappedContentFailure(details));
    const hyperrendererFetch = vi.fn(async () =>
      makeJsonResponse(200, makeRendererSuccess('rendered-fallback.html')),
    );
    const env = makeEnv(rendererFetch, hyperrendererFetch);

    const primaryError = await catchServiceCallError(callRenderer(env, renderParams));
    expect(getRendererFallbackReason(primaryError)).toBe('browser_rendering_dead_host');
    rendererFetch.mockClear();

    const outcome = await runRenderStep(env);

    expect(outcome).toMatchObject({ fallbackUsed: true, fallbackReason: 'browser_rendering_dead_host' });
    expect(rendererFetch).toHaveBeenCalledTimes(1);
    expect(hyperrendererFetch).toHaveBeenCalledTimes(1);
  });

  it('renders a rejected proxy error page through the hyperrenderer once', async () => {
    const rendererFetch = vi.fn(async () =>
      makeJsonResponse(502, {
        error: 'Browser Rendering /content returned a proxy/network error page',
        reason: PROXY_ERROR_PAGE_REASON,
        detail: 'dial tcp: lookup www.explorminate.net on 1.1.1.1:53: no such host',
        url: 'https://www.explorminate.net/post',
      }),
    );
    const hyperrendererFetch = vi.fn(async () =>
      makeJsonResponse(200, makeRendererSuccess('rendered-fallback.html')),
    );

    const outcome = await runRenderStep(makeEnv(rendererFetch, hyperrendererFetch));

    expect(outcome).toMatchObject({ fallbackUsed: true, fallbackReason: 'browser_rendering_proxy_error_page' });
    expect(rendererFetch).toHaveBeenCalledTimes(1);
    expect(hyperrendererFetch).toHaveBeenCalledTimes(1);
  });
});

describe('when the primary renderer and the hyperrenderer both fail', () => {
  const primaries: Array<[string, () => Response, string]> = [
    ['an access-blocked page', () => wrappedContentFailure('forbidden', 403), 'forbidden'],
    [
      'an unreachable host',
      () => wrappedContentFailure('dial tcp: lookup www.explorminate.net on 1.1.1.1:53: no such host'),
      'no such host',
    ],
    [
      'a rejected proxy error page',
      () =>
        makeJsonResponse(502, {
          error: 'Browser Rendering /content returned a proxy/network error page',
          reason: PROXY_ERROR_PAGE_REASON,
          detail: 'dial tcp: lookup www.explorminate.net on 1.1.1.1:53: no such host',
          url: 'https://www.explorminate.net/post',
        }),
      'proxy/network error page',
    ],
  ];
  const fallbacks: Array<[string, () => Promise<Response>, string]> = [
    ['answers 503', async () => new Response('Service Unavailable', { status: 503 }), '503'],
    ['answers 429', async () => new Response('Too Many Requests', { status: 429 }), '429'],
    [
      'loses the connection',
      async () => {
        throw new TypeError('network connection lost');
      },
      'network connection lost',
    ],
  ];
  const cases = primaries.flatMap(([primaryLabel, primaryResponse, primaryText]) =>
    fallbacks.map(
      ([fallbackLabel, fallbackFetch, fallbackText]) =>
        [primaryLabel, fallbackLabel, primaryResponse, fallbackFetch, primaryText, fallbackText] as const,
    ),
  );

  it.each(cases)(
    'fails the render step once on %s when the hyperrenderer %s',
    async (_primaryLabel, _fallbackLabel, primaryResponse, fallbackFetch, primaryText, fallbackText) => {
      const rendererFetch = vi.fn(async () => primaryResponse());
      const hyperrendererFetch = vi.fn(fallbackFetch);

      const error = await runRenderStep(makeEnv(rendererFetch, hyperrendererFetch)).then(
        () => undefined,
        (err: unknown) => err,
      );

      expect(error).toBeInstanceOf(FakeNonRetryableError);
      const message = error instanceof Error ? error.message : '';
      expect(message).toMatch(/primary=.*; fallback=/);
      const [primaryPart, fallbackPart] = message.split('; fallback=');
      expect(primaryPart).toContain(primaryText);
      expect(fallbackPart).toContain(fallbackText);
      expect(rendererFetch).toHaveBeenCalledTimes(1);
      expect(hyperrendererFetch).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps the pair retryable when only the hyperrenderer judged the page not worth a retry', async () => {
    const rendererFetch = vi.fn(async () =>
      makeJsonResponse(502, {
        error: 'Browser Rendering /content failed',
        status: 422,
        details: JSON.stringify({ success: false, errors: [{ code: 5006, message: 'browser disconnected' }] }),
      }),
    );
    const hyperrendererFetch = vi.fn(async () => wrappedContentFailure('forbidden', 403));

    const error = await catchServiceCallError(
      callRendererWith403Fallback(makeEnv(rendererFetch, hyperrendererFetch), renderParams),
    );

    expect(error.message).toMatch(/primary=.*; fallback=/);
    expect(error.classification.retryable).toBe(true);
  });

  it('names the fallback and its stealth setting in the error that names both failures', async () => {
    const rendererFetch = vi.fn(async () =>
      wrappedContentFailure('dial tcp: lookup www.explorminate.net on 1.1.1.1:53: no such host'),
    );
    const hyperrendererFetch = vi.fn(async () =>
      makeJsonResponse(500, { error: 'Internal error', message: 'challenge page', stealth: 'auto' }),
    );

    const error = await catchServiceCallError(
      callRendererWith403Fallback(makeEnv(rendererFetch, hyperrendererFetch), renderParams),
    );

    expect(readRenderFallbackFailure(error.message)).toEqual({
      fallbackReason: 'browser_rendering_dead_host',
      fallbackStealth: 'auto',
    });
  });

  it('reads no fallback from a render error that names none', () => {
    expect(readRenderFallbackFailure('Service error 500: upstream failure')).toBeUndefined();
  });

  it('keeps the access-blocked classification on the error that names both failures', async () => {
    const rendererFetch = vi.fn(async () => wrappedContentFailure('forbidden', 403));
    const hyperrendererFetch = vi.fn(async () => new Response('Service Unavailable', { status: 503 }));

    const error = await catchServiceCallError(
      callRendererWith403Fallback(makeEnv(rendererFetch, hyperrendererFetch), renderParams),
    );

    expect(error.classification).toEqual({
      errorCode: 'ACCESS_BLOCKED',
      retryable: false,
      recommendedAction: 'check_access',
    });
  });
});

const monolithParams = {
  request_id: 'req-monolith-step',
  rendered_html_key: 'archives/req-monolith-step/raw/rendered.html',
  base_url: 'https://example.com',
};

function makeMonolithEnv(monolithFetch: ReturnType<typeof vi.fn>): Env {
  return {
    INTERNAL_API_KEY: 'test-internal-key',
    MONOLITH: { fetch: monolithFetch },
  } as unknown as Env;
}

/** The monolith step: one first attempt and one retry. */
function runMonolithStep(env: Env): Promise<unknown> {
  return runWithRetries(1, () =>
    callMonolithForStep(env, monolithParams, (m) => new FakeNonRetryableError(m)),
  );
}

describe('the wait before the monolith retry', () => {
  it('waits 6 s after an ordinary failure', () => {
    expect(monolithRetryDelayMs(new Error('Service error 500: upstream failure'))).toBe(6000);
  });

  it('adds the container readiness hint, capped at 5 s, when the container was not ready', () => {
    const notReady = (ms: number) =>
      new Error(
        `Service error 503: {"error":"Internal error","message":"Sandbox container not ready (retry after ${ms} ms)","code":"MONOLITH_CONTAINER_UNAVAILABLE","retryable":true}`,
      );
    expect(monolithRetryDelayMs(notReady(3000))).toBe(9000);
    expect(monolithRetryDelayMs(notReady(60000))).toBe(11000);
  });
});

describe('monolith step failures', () => {
  it('fails at once on an input that is too large', async () => {
    const monolithFetch = vi.fn(async () =>
      makeJsonResponse(500, { error: 'Internal error', message: 'Monolith input too large: 40000000 bytes' }),
    );

    const failure = await runMonolithStep(makeMonolithEnv(monolithFetch)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(FakeNonRetryableError);
    expect(failure instanceof Error ? failure.message : '').toContain('[classified MONOLITH_INPUT_TOO_LARGE final');
    expect(monolithFetch).toHaveBeenCalledTimes(1);
  });

  it('fails at once on the 32 MiB RPC limit', async () => {
    const monolithFetch = vi.fn(async () =>
      makeJsonResponse(500, {
        error: 'Internal error',
        message:
          'Message length too big: found 33640795 bytes, the max allowed message length is 33554432 bytes',
      }),
    );

    const failure = await runMonolithStep(makeMonolithEnv(monolithFetch)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(FakeNonRetryableError);
    expect(failure instanceof Error ? failure.message : '').toContain('[classified MONOLITH_RPC_32MIB_LIMIT final');
    expect(monolithFetch).toHaveBeenCalledTimes(1);
  });

  it('spends its retry on a monolith worker that answers 503', async () => {
    const monolithFetch = vi.fn(async () => new Response('upstream failure', { status: 503 }));

    const error = await catchServiceCallError(runMonolithStep(makeMonolithEnv(monolithFetch)));
    expect(error.classification.retryable).toBe(true);
    expect(monolithFetch).toHaveBeenCalledTimes(2);
  });
});
