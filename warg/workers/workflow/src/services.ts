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
import {
  INTERNAL_API_KEY_HEADER,
  classifyServiceFailure,
  classifyServiceTimeout,
  isRenderStealthMode,
  rendererFallbackReasonFromBody,
  withClassificationTag,
} from '@warg/shared';
import type { ErrorClassification, RenderStealthMode, RendererFallbackReason } from '@warg/shared';

export type ServiceErrorClassification = ErrorClassification;
export type { RendererFallbackReason };

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
          [INTERNAL_API_KEY_HEADER]: apiKey
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ServiceCallError(
          `Service timeout calling ${path}`,
          classifyServiceTimeout(path),
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
        classifyServiceFailure(path, response.status, text),
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
 * Used as fallback when primary renderer fails due to Browser Rendering access/network issues.
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

function ensureRendererResponseShape(
  result: RendererResponse,
  path: string
): RendererResponse {
  const record = result as unknown;
  const artifacts = record && typeof record === 'object'
    ? (record as Record<string, unknown>).artifacts
    : undefined;
  if (!Array.isArray(artifacts)) {
    throw new ServiceCallError(
      'Renderer returned invalid response shape: artifacts must be an array',
      {
        errorCode: 'RENDER_SERVICE_ERROR',
        retryable: true,
        recommendedAction: 'retry_full',
      },
      path,
      502,
      ''
    );
  }

  return result;
}

/**
 * Returns the fallback reason when the primary renderer reports an
 * access-blocked, unreachable-host or transient Browser Rendering failure that
 * the hyperrenderer may still render. Any other failure gets no fallback.
 */
export function getRendererFallbackReason(error: unknown): RendererFallbackReason | undefined {
  if (!(error instanceof ServiceCallError)) return undefined;
  if (error.path !== '/render') return undefined;
  if (!error.responseBody) return undefined;

  return rendererFallbackReasonFromBody(error.responseBody);
}

/**
 * Backward-compatible helper retained for existing call sites/tests.
 */
export function isBrowserRendering403ForRender(error: unknown): boolean {
  return getRendererFallbackReason(error) === 'browser_rendering_403';
}

export interface RendererCallOutcome {
  result: RendererResponse;
  fallbackUsed: boolean;
  fallbackReason?: RendererFallbackReason;
}

/** A fallback render that ran and failed: why it ran, and the stealth setting it used when its answer said. */
export interface RenderFallbackFailure {
  fallbackReason: RendererFallbackReason;
  fallbackStealth?: RenderStealthMode;
}

/**
 * The tag a failed fallback leaves in the render error message. The message is
 * what survives the workflow step boundary, so the step's failure log reads the
 * fallback back from it with readRenderFallbackFailure.
 */
const RENDER_FALLBACK_TAG = /\[render fallback reason=([a-z0-9_]+)(?: stealth=([a-z]+))?\]/;

function renderFallbackTag(failure: RenderFallbackFailure): string {
  const stealth = failure.fallbackStealth ? ` stealth=${failure.fallbackStealth}` : '';
  return `[render fallback reason=${failure.fallbackReason}${stealth}]`;
}

/** The fallback that a render error message names, or undefined when no fallback ran. */
export function readRenderFallbackFailure(message: string): RenderFallbackFailure | undefined {
  const match = RENDER_FALLBACK_TAG.exec(message);
  const reason = match?.[1];
  if (reason === undefined || !isRendererFallbackReason(reason)) return undefined;
  const stealth = match?.[2];
  return {
    fallbackReason: reason,
    ...(isRenderStealthMode(stealth) ? { fallbackStealth: stealth } : {}),
  };
}

const RENDERER_FALLBACK_REASONS: readonly RendererFallbackReason[] = [
  'browser_rendering_403',
  'browser_rendering_5006',
  'browser_rendering_6000',
  'browser_rendering_proxy_error_page',
  'browser_rendering_dead_host',
];

function isRendererFallbackReason(value: string): value is RendererFallbackReason {
  return RENDERER_FALLBACK_REASONS.some((reason) => reason === value);
}

/** The stealth setting a hyperrenderer error answer reports, if any. */
function stealthFromResponseBody(body: string | undefined): RenderStealthMode | undefined {
  if (!body) return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || !('stealth' in parsed)) return undefined;
    return isRenderStealthMode(parsed.stealth) ? parsed.stealth : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Call the primary renderer and, when it reports a failure that the
 * hyperrenderer may still render, call the hyperrenderer once. When both fail,
 * the error names both failures. If the primary failure cannot be retried
 * (blocked or unreachable page), the failed pair is not retryable either: a
 * retry would hit the same primary failure again.
 */
export async function callRendererWith403Fallback(
  env: Env,
  params: RendererParams
): Promise<RendererCallOutcome> {
  try {
    const result = ensureRendererResponseShape(await callRenderer(env, params), '/render');
    return { result, fallbackUsed: false };
  } catch (error) {
    const fallbackReason = getRendererFallbackReason(error);
    if (!fallbackReason || !(error instanceof ServiceCallError)) {
      throw error;
    }

    try {
      const result = ensureRendererResponseShape(
        await callHyperrenderer(env, params),
        '/render'
      );
      return {
        result,
        fallbackUsed: true,
        fallbackReason,
      };
    } catch (fallbackError) {
      const fallbackMessage =
        fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      const fallbackServiceError =
        fallbackError instanceof ServiceCallError ? fallbackError : undefined;
      const tag = renderFallbackTag({
        fallbackReason,
        fallbackStealth: stealthFromResponseBody(fallbackServiceError?.responseBody),
      });
      const message = `Renderer failed with Browser Rendering fallback-eligible error and fallback failed ${tag}. primary=${error.message}; fallback=${fallbackMessage}`;

      if (!error.classification.retryable) {
        throw new ServiceCallError(
          message,
          { ...error.classification, retryable: false },
          '/render',
          fallbackServiceError?.status ?? error.status,
          fallbackServiceError?.responseBody ?? error.responseBody
        );
      }
      // The primary failure was transient, so the pair is worth another attempt
      // whatever the hyperrenderer judged: the next attempt starts on the primary.
      if (fallbackServiceError) {
        throw new ServiceCallError(
          message,
          { ...fallbackServiceError.classification, retryable: true },
          fallbackServiceError.path,
          fallbackServiceError.status,
          fallbackServiceError.responseBody
        );
      }
      // The hyperrenderer gave no answer (a network failure); keep the primary's
      // retryable classification and the message that names both failures.
      throw new ServiceCallError(message, error.classification, '/render', error.status, error.responseBody);
    }
  }
}

/**
 * Rethrows a step failure: a `ServiceCallError` classified as not retryable goes
 * through `makeNonRetryable` so the step fails at once; every other error is
 * rethrown unchanged and keeps the step's retry policy.
 */
function rethrowForStep(error: unknown, makeNonRetryable: (message: string) => Error): never {
  if (error instanceof ServiceCallError && !error.classification.retryable) {
    throw makeNonRetryable(withClassificationTag(error.message, error.classification));
  }
  throw error;
}

/**
 * Body of the workflow's render step. A failure classified as not retryable is
 * rethrown through `makeNonRetryable` so the step fails at once instead of
 * spending its retries on a page that cannot render; every other error is
 * rethrown unchanged and keeps the step's retry policy. The factory is injected
 * so this module stays free of runtime-only imports and can be unit-tested.
 */
export async function callRendererForStep(
  env: Env,
  params: RendererParams,
  makeNonRetryable: (message: string) => Error
): Promise<RendererCallOutcome> {
  try {
    return await callRendererWith403Fallback(env, params);
  } catch (error) {
    rethrowForStep(error, makeNonRetryable);
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
 * Body of the workflow's singlefile step. A failure classified as not retryable
 * (such as a captured proxy error page) is rethrown through `makeNonRetryable`
 * so the step fails at once; every other error keeps the step's retry policy.
 * The factory is injected so this module stays free of runtime-only imports.
 */
export async function callSinglefileForStep(
  env: Env,
  params: SinglefileParams,
  makeNonRetryable: (message: string) => Error
): Promise<DerivativeResponse> {
  try {
    return await callSinglefile(env, params);
  } catch (error) {
    rethrowForStep(error, makeNonRetryable);
  }
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
 * Body of the workflow's monolith step. A deterministic failure (the 32 MiB RPC
 * limit, an input that is too large, or any classification that is not
 * retryable) is rethrown through `makeNonRetryable` so the step fails at once;
 * every other error keeps the step's retry policy. The factory is injected so
 * this module stays free of runtime-only imports.
 */
export async function callMonolithForStep(
  env: Env,
  params: MonolithParams,
  makeNonRetryable: (message: string) => Error
): Promise<DerivativeResponse> {
  try {
    return await callMonolith(env, params);
  } catch (error) {
    rethrowForStep(error, makeNonRetryable);
  }
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
