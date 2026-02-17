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

export interface ServiceErrorClassification {
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

export class ServiceCallError extends Error {
  classification: ServiceErrorClassification;
  path: string;
  status: number;
  responseBody: string;

  constructor(
    message: string,
    classification: ServiceErrorClassification,
    path: string,
    status: number,
    responseBody: string
  ) {
    super(message);
    this.name = 'ServiceCallError';
    this.classification = classification;
    this.path = path;
    this.status = status;
    this.responseBody = responseBody;
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
          classifyTimeout(path),
          path,
          0,
          ''
        );
      }
      throw err;
    }

    if (!response.ok) {
      const text = await response.text();
      throw new ServiceCallError(
        `Service error ${response.status}: ${text}`,
        classifyServiceFailure(path, response.status),
        path,
        response.status,
        text
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
 * Call the hyperrenderer service to render a URL.
 * Used as fallback when primary renderer fails due to Browser Rendering 403.
 */
export function callHyperrenderer(
  env: Env,
  params: RendererParams
): Promise<RendererResponse> {
  return serviceCall<RendererResponse>(
    env.HYPERRENDERER,
    '/render',
    params,
    env.INTERNAL_API_KEY,
    120000 // 2 minute timeout, same as primary renderer
  );
}

function looksLikeRenderer403Payload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;

  if (record.status !== 403) return false;

  const error = record.error;
  if (typeof error !== 'string') return false;

  return error.includes('Browser Rendering /content failed');
}

/**
 * True when primary renderer wrapped a Browser Rendering 403 response.
 * Current renderer returns status 502 with JSON payload containing status=403.
 */
export function isBrowserRendering403ForRender(error: unknown): boolean {
  if (!(error instanceof ServiceCallError)) return false;
  if (error.path !== '/render') return false;
  if (!error.responseBody) return false;

  try {
    const parsed = JSON.parse(error.responseBody) as unknown;
    return looksLikeRenderer403Payload(parsed);
  } catch {
    return false;
  }
}

export interface RendererCallOutcome {
  result: RendererResponse;
  fallbackUsed: boolean;
  fallbackReason?: 'browser_rendering_403';
}

/**
 * Call primary renderer and transparently fall back to hyperrenderer
 * when Browser Rendering returns a wrapped 403 failure.
 */
export async function callRendererWith403Fallback(
  env: Env,
  params: RendererParams
): Promise<RendererCallOutcome> {
  try {
    const result = await callRenderer(env, params);
    return { result, fallbackUsed: false };
  } catch (error) {
    if (!isBrowserRendering403ForRender(error)) {
      throw error;
    }

    const primaryMessage = error instanceof Error ? error.message : String(error);
    try {
      const result = await callHyperrenderer(env, params);
      return {
        result,
        fallbackUsed: true,
        fallbackReason: 'browser_rendering_403',
      };
    } catch (fallbackError) {
      if (fallbackError instanceof ServiceCallError) {
        throw new ServiceCallError(
          `Renderer failed with Browser Rendering 403 and fallback failed. primary=${primaryMessage}; fallback=${fallbackError.message}`,
          fallbackError.classification,
          fallbackError.path,
          fallbackError.status,
          fallbackError.responseBody
        );
      }
      throw fallbackError;
    }
  }
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
    240000 // 4 minute timeout
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
