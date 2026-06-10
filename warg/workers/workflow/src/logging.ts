import type { EventType, LogLevel } from '@warg/shared';
import { createEvent } from '@warg/shared';
import type { RequestErrorCode, UserActionHint } from '@warg/shared';

interface ClassifiedError {
  errorCode: RequestErrorCode;
  retryable: boolean;
  recommendedAction: UserActionHint;
}

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
  const msg = errorMsg.toLowerCase();
  const monolithError = classifyMonolithError(msg);
  if (monolithError) return monolithError;

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
 * Log an event to the logger service.
 */
export async function logEvent(
  env: Env,
  requestId: string,
  type: EventType,
  message: string,
  data?: Record<string, unknown>,
  level: LogLevel = 'info'
): Promise<void> {
  const event = createEvent('workflow', type, level, message, data);

  try {
    const response = await env.LOGGER.fetch('https://logger/event', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-API-Key': env.INTERNAL_API_KEY
      },
      body: JSON.stringify({ requestId, event })
    });

    if (!response.ok) {
      console.error(`[workflow] Failed to log event: ${await response.text()}`);
    }
  } catch (err) {
    // Log to console but don't throw - logging should not block workflow
    console.error('[workflow] Error logging event:', err);
  }
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
  const classified = fromErrorObject(error) ?? classifyError('request', errorMsg);
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
