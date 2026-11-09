import type { EventType, LogEvent, LogLevel, RequestSettle } from '@warg/shared';
import {
  createEvent,
  isDeadHostErrorText,
  isIncompleteDegradation,
  isRequestErrorCode,
  isUserActionHint,
  PROXY_ERROR_PAGE_REASON,
} from '@warg/shared';
import type { RequestErrorCode } from '@warg/shared';
import { readClassificationTag, type ErrorClassification } from './classification-tag.js';
import type { WorkflowResult } from './types.js';

type ClassifiedError = ErrorClassification;

function fromErrorObject(error: string | Error): ClassifiedError | undefined {
  if (!(error instanceof Error)) return undefined;
  const value = (error as unknown as { classification?: ClassifiedError }).classification;
  if (!value) return undefined;
  return value;
}

function classifyMonolithError(errorMsgLower: string): ClassifiedError | undefined {
  const mentionsMonolith =
    errorMsgLower.includes('/monolith') ||
    errorMsgLower.includes('monolith') ||
    errorMsgLower.includes('sandboxerror');
  if (!mentionsMonolith) return undefined;

  if (
    errorMsgLower.includes('message length too big') ||
    errorMsgLower.includes('max allowed message length') ||
    errorMsgLower.includes('33554432') ||
    errorMsgLower.includes('32mib')
  ) {
    return {
      errorCode: 'MONOLITH_RPC_32MIB_LIMIT',
      retryable: false,
      recommendedAction: 'investigate_service',
    };
  }

  if (errorMsgLower.includes('monolith input too large')) {
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

export function classifyError(stepName: string, errorMsg: string): ClassifiedError {
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

/**
 * Module-private helper: POST a JSON body to the logger service binding.
 * Never throws — logging must not block workflow execution.
 * @param label  Short description used in failure log messages (e.g. "event [step.started] for req123" or "event batch for req123 (4 events)")
 */
async function loggerPost(env: Env, path: string, body: unknown, label: string): Promise<void> {
  try {
    const response = await env.LOGGER.fetch(`https://logger${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-API-Key': env.INTERNAL_API_KEY
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const text = (await response.text()).slice(0, 300);
      console.error(`[workflow] Failed to log ${label}: ${text}`);
    }
  } catch (err) {
    console.error(`[workflow] Error logging ${label}:`, err);
  }
}

/**
 * Log an event to the logger service.
 */
export function logEvent(
  env: Env,
  requestId: string,
  type: EventType,
  message: string,
  data?: Record<string, unknown>,
  level: LogLevel = 'info'
): Promise<void> {
  const event = createEvent('workflow', type, level, message, data);
  return loggerPost(env, '/event', { requestId, event }, `event [${type}] for ${requestId}`);
}

/**
 * Append a batch of events in one logger round-trip (atomic on the logger
 * side). Use inside multi-event step callbacks; terminal events
 * (request.done / request.failed) must stay on per-event logEvent calls so
 * SSE consumers see them immediately.
 */
export async function logEvents(
  env: Env,
  requestId: string,
  events: LogEvent[]
): Promise<void> {
  if (events.length === 0) return;
  await loggerPost(
    env,
    '/events/batch',
    { requestId, events },
    `event batch for ${requestId} (${events.length} events)`
  );
}

/**
 * Log a step started event.
 */
export function logStepStarted(
  env: Env,
  requestId: string,
  stepName: string,
  data?: Record<string, unknown>
): Promise<void> {
  return logEvent(env, requestId, 'step.started', `Step started: ${stepName}`, {
    step: stepName,
    ...data
  });
}

/**
 * Log a step completed event.
 */
export function logStepCompleted(
  env: Env,
  requestId: string,
  stepName: string,
  data?: Record<string, unknown>
): Promise<void> {
  return logEvent(
    env,
    requestId,
    'step.completed',
    `Step completed: ${stepName}`,
    { step: stepName, ...data }
  );
}

/**
 * Log a step completed event with duration tracking.
 * Computes duration_ms from startedAt timestamp.
 */
export function logStepCompletedWithDuration(
  env: Env,
  requestId: string,
  stepName: string,
  startedAt: number,
  data?: Record<string, unknown>
): Promise<void> {
  const durationMs = Date.now() - startedAt;
  return logStepCompleted(env, requestId, stepName, { ...data, duration_ms: durationMs });
}

/**
 * Build a step.completed event with duration tracking for batched logging.
 * Same payload as logStepCompletedWithDuration, returned instead of sent.
 */
export function stepCompletedEvent(
  stepName: string,
  startedAt: number,
  data?: Record<string, unknown>
): LogEvent {
  const durationMs = Date.now() - startedAt;
  return createEvent('workflow', 'step.completed', 'info', `Step completed: ${stepName}`, {
    step: stepName,
    ...data,
    duration_ms: durationMs
  });
}

/**
 * Log a step failed event.
 * Accepts string or Error. If Error, includes truncated stack trace.
 */
export function logStepFailed(
  env: Env,
  requestId: string,
  stepName: string,
  error: string | Error,
  data?: Record<string, unknown>
): Promise<void> {
  const errorMsg = error instanceof Error ? error.message : error;
  const stack = error instanceof Error ? error.stack?.slice(0, 1000) : undefined;
  const classified = fromErrorObject(error) ?? classifyError(stepName, errorMsg);
  return logEvent(
    env,
    requestId,
    'step.failed',
    `Step failed: ${stepName}: ${errorMsg}`,
    {
      step: stepName,
      error: errorMsg,
      errorCode: classified.errorCode,
      retryable: classified.retryable,
      recommendedAction: classified.recommendedAction,
      ...(stack ? { stack } : {}),
      ...data
    },
    'error'
  );
}

/**
 * Log an artifact written event.
 */
export function logArtifactWritten(
  env: Env,
  requestId: string,
  kind: string,
  r2Key: string,
  bytes: number,
  contentType: string,
  sha256: string
): Promise<void> {
  return logEvent(env, requestId, 'artifact.written', `Artifact written: ${kind}`, {
    kind,
    r2Key,
    bytes,
    contentType,
    sha256
  });
}

/**
 * Build an artifact.written event for batched logging.
 * Same payload as logArtifactWritten, returned instead of sent.
 */
export function artifactWrittenEvent(
  kind: string,
  r2Key: string,
  bytes: number,
  contentType: string,
  sha256: string
): LogEvent {
  return createEvent('workflow', 'artifact.written', 'info', `Artifact written: ${kind}`, {
    kind,
    r2Key,
    bytes,
    contentType,
    sha256
  });
}

/**
 * Log a terminal request.done event.
 */
export function logRequestDone(
  env: Env,
  requestId: string,
  data?: Record<string, unknown>
): Promise<void> {
  return logEvent(env, requestId, 'request.done', 'Request completed', data);
}

/**
 * Classify a run's terminal failure: the error's own classification or its
 * message, then a valid code, retryable flag or action from the terminal
 * details (the details of a WorkflowTerminalError) override it.
 */
export function classifyTerminalFailure(
  error: string | Error,
  details?: Record<string, unknown>
): ClassifiedError & { errorMessage: string } {
  const errorMessage = error instanceof Error ? error.message : error;
  const classified = fromErrorObject(error) ?? classifyError('request', errorMessage);
  const errorCode = details?.['errorCode'];
  const retryable = details?.['retryable'];
  const recommendedAction = details?.['recommendedAction'];
  return {
    errorCode: isRequestErrorCode(errorCode) ? errorCode : classified.errorCode,
    retryable: typeof retryable === 'boolean' ? retryable : classified.retryable,
    recommendedAction: isUserActionHint(recommendedAction)
      ? recommendedAction
      : classified.recommendedAction,
    errorMessage,
  };
}

/**
 * Log a terminal request.failed event.
 * Accepts string or Error. If Error, includes truncated stack trace.
 */
export function logRequestFailed(
  env: Env,
  requestId: string,
  error: string | Error,
  data?: Record<string, unknown>
): Promise<void> {
  const errorMsg = error instanceof Error ? error.message : error;
  const stack = error instanceof Error ? error.stack?.slice(0, 1000) : undefined;
  const classified = classifyTerminalFailure(error);
  return logEvent(
    env,
    requestId,
    'request.failed',
    `Request failed: ${errorMsg}`,
    {
      error: errorMsg,
      errorCode: classified.errorCode,
      retryable: classified.retryable,
      recommendedAction: classified.recommendedAction,
      ...(stack ? { stack } : {}),
      ...data
    },
    'error'
  );
}

/**
 * Send the terminal state a run settled in to the logger.
 * Unlike the event helpers this throws on a non-2xx answer or a network
 * error, so the step that calls it is retried.
 */
export async function settleRequest(
  env: Env,
  requestId: string,
  settle: RequestSettle
): Promise<void> {
  const response = await env.LOGGER.fetch(
    `https://logger/request/${encodeURIComponent(requestId)}/settle`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-API-Key': env.INTERNAL_API_KEY
      },
      body: JSON.stringify(settle),
      signal: AbortSignal.timeout(10_000),
    }
  );
  if (!response.ok) {
    const text = (await response.text()).slice(0, 300);
    throw new Error(`Logger settle answered ${response.status}: ${text}`);
  }
}

/** The settle of a run that returned: incomplete when monolith degraded, else done. */
export function settleForResult(
  result: WorkflowResult,
  runId: string,
  settledAt: string
): RequestSettle {
  const incomplete =
    result.degraded === true &&
    isIncompleteDegradation(result.partialFailures?.map((failure) => failure.step));
  return { state: incomplete ? 'incomplete' : 'done', runId, settledAt };
}

/** The settle of a run that threw: failed, with the code the failure log records. */
export function settleForFailure(
  error: string | Error,
  details: Record<string, unknown> | undefined,
  runId: string,
  settledAt: string
): RequestSettle {
  return { state: 'failed', runId, settledAt, ...classifyTerminalFailure(error, details) };
}

/**
 * Update the manifest key in the logger.
 */
export async function updateManifestKey(
  env: Env,
  requestId: string,
  manifestR2Key: string
): Promise<void> {
  try {
    const response = await env.LOGGER.fetch(
      `https://logger/request/${requestId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-API-Key': env.INTERNAL_API_KEY
        },
        body: JSON.stringify({ manifestR2Key })
      }
    );

    if (!response.ok) {
      console.error(`[workflow] Failed to update manifest key: ${await response.text()}`);
    }
  } catch (err) {
    console.error('[workflow] Error updating manifest key:', err);
  }
}
