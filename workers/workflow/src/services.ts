import type {
  RendererParams,
  RendererResponse,
  DerivativeParams,
  DerivativeResponse,
  ReadabilityResponse,
  MonolithParams,
  GcsParams,
  GcsResponse,
  SinglefileParams
} from './types.js';
import type { RequestErrorCode, UserActionHint } from '@warg/shared';

interface ServiceErrorClassification {
  errorCode: RequestErrorCode;
  retryable: boolean;
  recommendedAction: UserActionHint;
}

function classifyTimeout(path: string): ServiceErrorClassification {
  const byPath: Record<string, RequestErrorCode> = {
    '/render': 'RENDER_TIMEOUT',
    '/singlefile': 'SINGLEFILE_TIMEOUT',
    '/readability': 'READABILITY_TIMEOUT',
    '/monolith': 'MONOLITH_TIMEOUT',
  };
  return {
    errorCode: byPath[path] ?? 'UNKNOWN_ERROR',
    retryable: true,
    recommendedAction: 'retry_step',
  };
}

function classifyServiceFailure(path: string, status: number): ServiceErrorClassification {
  if (status === 401 || status === 403) {
    return {
      errorCode: 'ACCESS_BLOCKED',
      retryable: false,
      recommendedAction: 'check_access',
    };
  }

  const byPath: Record<string, RequestErrorCode> = {
    '/render': 'RENDER_SERVICE_ERROR',
    '/singlefile': 'SINGLEFILE_SERVICE_ERROR',
    '/readability': 'READABILITY_SERVICE_ERROR',
    '/monolith': 'MONOLITH_SERVICE_ERROR',
    '/persist': 'PERSIST_SERVICE_ERROR',
  };

  const retryable = status === 429 || status >= 500;
  return {
    errorCode: byPath[path] ?? 'UNKNOWN_ERROR',
    retryable,
    recommendedAction: retryable ? 'retry_step' : 'investigate_service',
  };
}

class ServiceCallError extends Error {
  classification: ServiceErrorClassification;

  constructor(message: string, classification: ServiceErrorClassification) {
    super(message);
    this.name = 'ServiceCallError';
    this.classification = classification;
  }
}

/**
 * Generic service call helper with timeout.
 */
async function serviceCall<T>(
  fetcher: Fetcher,
  path: string,
  body: unknown,
  apiKey: string,
  timeoutMs = 60000
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetcher.fetch(`https://service${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-API-Key': apiKey
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ServiceCallError(
          `Service timeout calling ${path}`,
          classifyTimeout(path)
        );
      }
      throw err;
    }

    if (!response.ok) {
      const text = await response.text();
      throw new ServiceCallError(
        `Service error ${response.status}: ${text}`,
        classifyServiceFailure(path, response.status)
      );
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Call the renderer service to render a URL.
 * Returns rendered HTML, optional screenshot, and optional PDF.
 */
export function callRenderer(
  env: Env,
  params: RendererParams
): Promise<RendererResponse> {
  return serviceCall<RendererResponse>(
    env.RENDERER,
    '/render',
    params,
    env.INTERNAL_API_KEY,
    120000 // 2 minute timeout for browser rendering
  );
}

/**
 * Call the singlefile service to extract a self-contained HTML.
 * SingleFile navigates to the live URL and captures resources inline.
 */
export function callSinglefile(
  env: Env,
  params: SinglefileParams
): Promise<DerivativeResponse> {
  return serviceCall<DerivativeResponse>(
    env.SINGLEFILE,
    '/singlefile',
    params,
    env.INTERNAL_API_KEY,
    180000 // 3 minute timeout
  );
}

/**
 * Call the readability service to extract readable content.
 */
export function callReadability(
  env: Env,
  params: DerivativeParams
): Promise<ReadabilityResponse> {
  return serviceCall<ReadabilityResponse>(
    env.READABILITY,
    '/readability',
    params,
    env.INTERNAL_API_KEY,
    120000 // 2 minute timeout
  );
}

/**
 * Call the monolith service to extract a monolith HTML.
 */
export function callMonolith(
  env: Env,
  params: MonolithParams
): Promise<DerivativeResponse> {
  return serviceCall<DerivativeResponse>(
    env.MONOLITH,
    '/monolith',
    params,
    env.INTERNAL_API_KEY,
    120000 // 2 minute timeout
  );
}

/**
 * Call the GCS service to persist artifacts.
 */
export function callGcs(env: Env, params: GcsParams): Promise<GcsResponse> {
  return serviceCall<GcsResponse>(
    env.GCS,
    '/persist',
    params,
    env.INTERNAL_API_KEY,
    600000 // 10 minute timeout for large uploads
  );
}
