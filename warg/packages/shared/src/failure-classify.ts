import { isRequestErrorCode, isUserActionHint } from './dashboard.js';
import { isDeadHostErrorText, PROXY_ERROR_PAGE_REASON } from './render-content.js';
import type { RequestErrorCode, UserActionHint } from './dashboard.js';

/** How a failure is classified: its code, whether a retry can help, and what to do next. */
export interface ErrorClassification {
  errorCode: RequestErrorCode;
  retryable: boolean;
  recommendedAction: UserActionHint;
}

// --- The classification tag --------------------------------------------------

/**
 * A step failure leaves its step as a message only: properties set on the error object
 * do not survive the step boundary. The classification made where the failure was seen
 * therefore travels as a tag at the end of the message, and the failure log reads it
 * back instead of guessing from the message text.
 */
const CLASSIFICATION_TAG = /\[classified ([A-Z0-9_]+) (retryable|final) ([a-z_]+)\]/g;

/** The message with the classification tag appended. */
export function withClassificationTag(message: string, classification: ErrorClassification): string {
  const retry = classification.retryable ? 'retryable' : 'final';
  return `${message} [classified ${classification.errorCode} ${retry} ${classification.recommendedAction}]`;
}

/** The classification of the last valid tag in a message, or undefined when it carries none. */
export function readClassificationTag(message: string): ErrorClassification | undefined {
  let found: ErrorClassification | undefined;
  for (const [, errorCode = '', retry, recommendedAction = ''] of message.matchAll(CLASSIFICATION_TAG)) {
    if (isRequestErrorCode(errorCode) && isUserActionHint(recommendedAction)) {
      found = { errorCode, retryable: retry === 'retryable', recommendedAction };
    }
  }
  return found;
}

// --- Monolith text rules -----------------------------------------------------

/**
 * Detect the Cloudflare Sandbox RPC 32 MiB size-limit error from its message.
 *
 * Hit when a value crossing the host↔container RPC boundary (exec output capture
 * or `readFile`/`writeFile`) exceeds the serialized-RPC ceiling. monolith
 * base64-inlines every asset, so a heavy page can yield >32 MiB of output. This
 * is deterministic for a given input, so callers must treat it as
 * NON-retryable.
 */
export function isRpc32MiBLimit(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('32mib') ||
    lower.includes('33554432') ||
    lower.includes('message length too big') ||
    lower.includes('max allowed message length')
  );
}

/** True when a message reports the workflow's refusal of a monolith input over its size cap. */
export function isMonolithInputTooLarge(message: string): boolean {
  return message.toLowerCase().includes('monolith input too large');
}

/** The sandbox's own timeout words: unlike the service and message rules, `abort` is not one. */
function isSandboxTimeoutText(lower: string): boolean {
  return lower.includes('timeout') || lower.includes('timed out') || lower.includes('deadline exceeded');
}

export type SandboxFailureCode = 'MONOLITH_RPC_32MIB_LIMIT' | 'MONOLITH_TIMEOUT' | 'MONOLITH_SANDBOX_500';

/** How a failed command inside the monolith sandbox is classified, from its stderr and stdout. */
export function classifySandboxOutput(
  stderr: string,
  stdout: string
): { errorCode: SandboxFailureCode; retryable: boolean } {
  const message = `${stderr}\n${stdout}`.toLowerCase();
  if (isRpc32MiBLimit(message)) return { errorCode: 'MONOLITH_RPC_32MIB_LIMIT', retryable: false };
  if (isSandboxTimeoutText(message)) return { errorCode: 'MONOLITH_TIMEOUT', retryable: true };
  return { errorCode: 'MONOLITH_SANDBOX_500', retryable: true };
}

// --- The step-message classifier ---------------------------------------------

function classifyMonolithError(errorMsgLower: string): ErrorClassification | undefined {
  const mentionsMonolith =
    errorMsgLower.includes('/monolith') ||
    errorMsgLower.includes('monolith') ||
    errorMsgLower.includes('sandboxerror');
  if (!mentionsMonolith) return undefined;

  if (isRpc32MiBLimit(errorMsgLower)) {
    return {
      errorCode: 'MONOLITH_RPC_32MIB_LIMIT',
      retryable: false,
      recommendedAction: 'investigate_service',
    };
  }

  if (isMonolithInputTooLarge(errorMsgLower)) {
    return {
      errorCode: 'MONOLITH_INPUT_TOO_LARGE',
      retryable: false,
      recommendedAction: 'investigate_service',
    };
  }

  if (
    errorMsgLower.includes('timeout') ||
    errorMsgLower.includes('timed out') ||
    errorMsgLower.includes('abort') ||
    errorMsgLower.includes('deadline exceeded')
  ) {
    return {
      errorCode: 'MONOLITH_TIMEOUT',
      retryable: true,
      recommendedAction: 'retry_step',
    };
  }

  if (
    errorMsgLower.includes('service error') ||
    errorMsgLower.includes('sandboxerror') ||
    errorMsgLower.includes('http error! status: 500') ||
    errorMsgLower.includes('container terminated')
  ) {
    return {
      errorCode: errorMsgLower.includes('sandboxerror') || errorMsgLower.includes('http error! status: 500')
        ? 'MONOLITH_SANDBOX_500'
        : 'MONOLITH_SERVICE_ERROR',
      retryable: true,
      recommendedAction: 'retry_step',
    };
  }

  return undefined;
}

/** How a failed workflow step is classified, from the step name and its failure message. */
export function classifyError(stepName: string, errorMsg: string): ErrorClassification {
  // The step that saw the failure already classified it: use that, not the text rules below.
  const tagged = readClassificationTag(errorMsg);
  if (tagged) return tagged;

  const msg = errorMsg.toLowerCase();
  const monolithError = classifyMonolithError(msg);
  if (monolithError) return monolithError;

  // A renderer or singlefile worker rejected the page as a proxy/network error
  // page whose text says the host cannot be reached, so the step was not retried.
  // A transient error page falls through to the retryable rules below.
  if (msg.includes(PROXY_ERROR_PAGE_REASON) && isDeadHostErrorText(errorMsg)) {
    const unreachableByStep: Record<string, RequestErrorCode> = {
      render: 'RENDER_SERVICE_ERROR',
      singlefile: 'SINGLEFILE_SERVICE_ERROR',
    };
    return {
      errorCode: unreachableByStep[stepName] ?? 'UNKNOWN_ERROR',
      retryable: false,
      recommendedAction: 'inspect_url',
    };
  }

  if (msg.includes('no requested outputs were produced')) {
    return {
      errorCode: 'NO_OUTPUTS_PRODUCED',
      retryable: true,
      recommendedAction: 'retry_full',
    };
  }

  if (msg.includes('missing rendered.html prerequisite')) {
    return {
      errorCode: 'RENDER_PREREQ_MISSING',
      retryable: true,
      recommendedAction: 'retry_full',
    };
  }

  if (
    msg.includes('5006') ||
    msg.includes('network closed') ||
    msg.includes('connection closed') ||
    msg.includes('browser has disconnected')
  ) {
    return {
      errorCode: 'RENDER_NETWORK_CLOSED',
      retryable: true,
      recommendedAction: 'retry_full',
    };
  }

  if (
    msg.includes('execution context was destroyed') ||
    msg.includes('code":6000') ||
    msg.includes('context destroyed')
  ) {
    return {
      errorCode: 'RENDER_CONTEXT_DESTROYED',
      retryable: true,
      recommendedAction: 'retry_full',
    };
  }

  if (
    msg.includes('trustedtypes') ||
    msg.includes('trustedhtml') ||
    msg.includes('not a valid selector') ||
    msg.includes('singlefile edge-case failure')
  ) {
    return {
      errorCode: 'SINGLEFILE_EDGE_CASE',
      retryable: true,
      recommendedAction: 'retry_step',
    };
  }

  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('abort')) {
    const timeoutByStep: Record<string, RequestErrorCode> = {
      render: 'RENDER_TIMEOUT',
      singlefile: 'SINGLEFILE_TIMEOUT',
      readability: 'READABILITY_TIMEOUT',
      monolith: 'MONOLITH_TIMEOUT',
    };
    return {
      errorCode: timeoutByStep[stepName] ?? 'UNKNOWN_ERROR',
      retryable: true,
      recommendedAction: stepName === 'render' ? 'retry_full' : 'retry_step',
    };
  }

  if (msg.includes('service error')) {
    const serviceByStep: Record<string, RequestErrorCode> = {
      render: 'RENDER_SERVICE_ERROR',
      singlefile: 'SINGLEFILE_SERVICE_ERROR',
      readability: 'READABILITY_SERVICE_ERROR',
      monolith: 'MONOLITH_SERVICE_ERROR',
      persist: 'PERSIST_SERVICE_ERROR',
      derivatives: 'MONOLITH_SERVICE_ERROR',
    };
    return {
      errorCode: serviceByStep[stepName] ?? 'UNKNOWN_ERROR',
      retryable: true,
      recommendedAction: stepName === 'persist' ? 'investigate_service' : 'retry_step',
    };
  }

  if (msg.includes('unauthorized') || msg.includes('access') || msg.includes('forbidden')) {
    return {
      errorCode: 'ACCESS_BLOCKED',
      retryable: false,
      recommendedAction: 'check_access',
    };
  }

  if (msg.includes('invalid url') || msg.includes('url is required')) {
    return {
      errorCode: 'INVALID_INPUT_URL',
      retryable: false,
      recommendedAction: 'inspect_url',
    };
  }

  return {
    errorCode: 'UNKNOWN_ERROR',
    retryable: true,
    recommendedAction: 'investigate_service',
  };
}

// --- The service-answer classifier -------------------------------------------

/** How a call that timed out is classified, by the service path. */
export function classifyServiceTimeout(path: string): ErrorClassification {
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
): ErrorClassification | undefined {
  const message = readMessageFromResponseBody(responseBody);
  if (!message) return undefined;
  const lower = message.toLowerCase();

  if (isRpc32MiBLimit(lower)) {
    return {
      errorCode: 'MONOLITH_RPC_32MIB_LIMIT',
      retryable: false,
      recommendedAction: 'investigate_service',
    };
  }

  if (isMonolithInputTooLarge(lower)) {
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
const UNREACHABLE_TARGET: ErrorClassification = {
  errorCode: 'RENDER_SERVICE_ERROR',
  retryable: false,
  recommendedAction: 'inspect_url',
};

function classifyRenderFailureFromBody(
  responseBody: string
): ErrorClassification | undefined {
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
): ErrorClassification | undefined {
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

function classifyStatusFailure(path: string, status: number): ErrorClassification {
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

/** How a failed service answer is classified, from its path, status and body. */
export function classifyServiceFailure(
  path: string,
  status: number,
  responseBody: string
): ErrorClassification {
  if (status === 401 || status === 403) {
    return classifyStatusFailure(path, status);
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
  return classifyStatusFailure(path, status);
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

/**
 * The fallback reason a failed primary-renderer answer body gives: an access-blocked,
 * unreachable-host or transient Browser Rendering failure that the hyperrenderer may
 * still render. Any other body gives none.
 */
export function rendererFallbackReasonFromBody(responseBody: string): RendererFallbackReason | undefined {
  try {
    const parsed = JSON.parse(responseBody) as unknown;
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
