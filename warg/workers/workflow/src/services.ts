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
import { isDeadHostErrorText, PROXY_ERROR_PAGE_REASON } from '@warg/shared';
import type { RequestErrorCode } from '@warg/shared';
import { withClassificationTag, type ErrorClassification } from './classification-tag.js';

export type ServiceErrorClassification = ErrorClassification;

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

function parseJsonSafe(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function readMessageFromResponseBody(responseBody: string): string | undefined {
  const parsed = parseJsonSafe(responseBody);
  if (!parsed || typeof parsed !== 'object') return undefined;
  const record = parsed as Record<string, unknown>;

  const message = record.message;
  if (typeof message === 'string') return message;

  const details = record.details;
  if (typeof details === 'string') return details;

  return undefined;
}

function classifyMonolithFailureFromBody(
  responseBody: string
): ServiceErrorClassification | undefined {
  const message = readMessageFromResponseBody(responseBody);
  if (!message) return undefined;
  const lower = message.toLowerCase();

  if (
    lower.includes('message length too big') ||
    lower.includes('max allowed message length') ||
    lower.includes('33554432') ||
    lower.includes('32mib')
  ) {
    return {
      errorCode: 'MONOLITH_RPC_32MIB_LIMIT',
      retryable: false,
      recommendedAction: 'investigate_service',
    };
  }

  if (lower.includes('monolith input too large')) {
    return {
      errorCode: 'MONOLITH_INPUT_TOO_LARGE',
      retryable: false,
      recommendedAction: 'investigate_service',
    };
  }

  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('deadline exceeded') ||
    lower.includes('abort')
  ) {
    return {
      errorCode: 'MONOLITH_TIMEOUT',
      retryable: true,
      recommendedAction: 'retry_step',
    };
  }

  if (lower.includes('sandboxerror') || lower.includes('http error! status: 500')) {
    return {
      errorCode: 'MONOLITH_SANDBOX_500',
      retryable: true,
      recommendedAction: 'retry_step',
    };
  }

  return undefined;
}

function containsRendererContextDestroyed6000(details: unknown): boolean {
  let parsedDetails: unknown = details;

  if (typeof details === 'string') {
    const lower = details.toLowerCase();
    if (
      lower.includes('6000') ||
      lower.includes('execution context was destroyed') ||
      lower.includes('context destroyed')
    ) {
      return true;
    }
    parsedDetails = parseJsonSafe(details);
  }

  if (!parsedDetails || typeof parsedDetails !== 'object') return false;
  const record = parsedDetails as Record<string, unknown>;
  const errors = record.errors;
  if (!Array.isArray(errors)) return false;
  return errors.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const code = (entry as Record<string, unknown>).code;
    return code === 6000 || code === '6000';
  });
}

/** A render failure whose target host cannot be reached: not worth a retry. */
const UNREACHABLE_TARGET: ServiceErrorClassification = {
  errorCode: 'RENDER_SERVICE_ERROR',
  retryable: false,
  recommendedAction: 'inspect_url',
};

function classifyRenderFailureFromBody(
  responseBody: string
): ServiceErrorClassification | undefined {
  const parsed = parseJsonSafe(responseBody);
  if (!parsed || typeof parsed !== 'object') return undefined;
  const record = parsed as Record<string, unknown>;
  // The renderer rejected a proxy/network error page. Its text says whether the
  // host cannot be reached (another attempt reaches it no better) or the failure
  // was transient (a timeout or reset, which a retry can clear).
  if (record.reason === PROXY_ERROR_PAGE_REASON) {
    return isProxyErrorPageDeadHost(record) ? UNREACHABLE_TARGET : undefined;
  }
  if (!looksLikeRendererContentFailurePayload(record)) return undefined;

  if (containsRendererNetworkClosed5006(record.details)) {
    return {
      errorCode: 'RENDER_NETWORK_CLOSED',
      retryable: true,
      recommendedAction: 'retry_full',
    };
  }

  if (containsRendererContextDestroyed6000(record.details)) {
    return {
      errorCode: 'RENDER_CONTEXT_DESTROYED',
      retryable: true,
      recommendedAction: 'retry_full',
    };
  }

  const status = typeof record.status === 'number' ? record.status : Number(record.status);
  if (status === 403) {
    return {
      errorCode: 'ACCESS_BLOCKED',
      retryable: false,
      recommendedAction: 'check_access',
    };
  }

  if (isDeadHostFailure(record.details)) return UNREACHABLE_TARGET;

  return undefined;
}

/**
 * True when a wrapped Browser Rendering failure says the target host cannot be
 * reached. A failure that also reports a timeout stays retryable: a dial that
 * timed out can succeed on the next attempt.
 */
function isDeadHostFailure(details: unknown): boolean {
  const text = typeof details === 'string' ? details : JSON.stringify(details) ?? '';
  return isDeadHostErrorText(text);
}

/** True when a renderer's proxy error page rejection carries a dead-host error text. */
function isProxyErrorPageDeadHost(record: Record<string, unknown>): boolean {
  return typeof record.detail === 'string' && isDeadHostErrorText(record.detail);
}

function classifySinglefileFailureFromBody(
  responseBody: string
): ServiceErrorClassification | undefined {
  const parsed = parseJsonSafe(responseBody);
  if (!parsed || typeof parsed !== 'object') return undefined;
  const record = parsed as Record<string, unknown>;
  // The worker captured the proxy's error page. For a host it cannot reach,
  // another capture reaches it no better; a transient error text stays retryable.
  if (record.reason === PROXY_ERROR_PAGE_REASON) {
    if (!isProxyErrorPageDeadHost(record)) return undefined;
    return {
      errorCode: 'SINGLEFILE_SERVICE_ERROR',
      retryable: false,
      recommendedAction: 'inspect_url',
    };
  }
  // The worker marks page-environment edge cases (Trusted Types, selector
  // errors) as recoverable: a fresh browser often captures the page.
  if (record.recoverable === true) {
    return {
      errorCode: 'SINGLEFILE_EDGE_CASE',
      retryable: true,
      recommendedAction: 'retry_step',
    };
  }
  return undefined;
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

function classifyServiceFailureWithBody(
  path: string,
  status: number,
  responseBody: string
): ServiceErrorClassification {
  if (status === 401 || status === 403) {
    return classifyServiceFailure(path, status);
  }
  if (path === '/monolith') {
    const classified = classifyMonolithFailureFromBody(responseBody);
    if (classified) return classified;
  }
  if (path === '/render') {
    const classified = classifyRenderFailureFromBody(responseBody);
    if (classified) return classified;
  }
  if (path === '/singlefile') {
    const classified = classifySinglefileFailureFromBody(responseBody);
    if (classified) return classified;
  }
  return classifyServiceFailure(path, status);
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
        classifyServiceFailureWithBody(path, response.status, text),
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

function looksLikeRendererContentFailurePayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;

  const error = record.error;
  if (typeof error !== 'string') return false;

  return error.includes('Browser Rendering /content failed');
}

function containsRendererNetworkClosed5006(details: unknown): boolean {
  let parsedDetails: unknown = details;

  if (typeof details === 'string') {
    const lower = details.toLowerCase();
    if (
      lower.includes('5006') ||
      lower.includes('network closed') ||
      lower.includes('connection closed') ||
      lower.includes('browser has disconnected') ||
      lower.includes('target closed')
    ) {
      return true;
    }
    parsedDetails = parseJsonSafe(details);
  }

  if (!parsedDetails || typeof parsedDetails !== 'object') return false;
  const record = parsedDetails as Record<string, unknown>;
  const errors = record.errors;
  if (!Array.isArray(errors)) return false;
  return errors.some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const code = (entry as Record<string, unknown>).code;
    return code === 5006 || code === '5006';
  });
}

export type RendererFallbackReason =
  | 'browser_rendering_403'
  | 'browser_rendering_5006'
  | 'browser_rendering_6000'
  | 'browser_rendering_proxy_error_page'
  | 'browser_rendering_dead_host';

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

  try {
    const parsed = JSON.parse(error.responseBody) as unknown;
    if (!parsed || typeof parsed !== 'object') return undefined;
    const record = parsed as Record<string, unknown>;
    // The primary renderer rejected a proxy/network error page. Browser
    // Rendering could not reach the target, but Hyperbrowser may still reach it.
    if (record.reason === PROXY_ERROR_PAGE_REASON) {
      return 'browser_rendering_proxy_error_page';
    }
    if (!looksLikeRendererContentFailurePayload(record)) return undefined;

    const status =
      typeof record.status === 'number'
        ? record.status
        : Number(record.status);
    if (status === 403) return 'browser_rendering_403';
    if (containsRendererNetworkClosed5006(record.details)) {
      return 'browser_rendering_5006';
    }
    if (containsRendererContextDestroyed6000(record.details)) {
      return 'browser_rendering_6000';
    }
    if (isDeadHostFailure(record.details)) return 'browser_rendering_dead_host';
    return undefined;
  } catch {
    return undefined;
  }
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
      const message = `Renderer failed with Browser Rendering fallback-eligible error and fallback failed. primary=${error.message}; fallback=${fallbackMessage}`;
      const fallbackServiceError =
        fallbackError instanceof ServiceCallError ? fallbackError : undefined;

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
      throw fallbackError;
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
