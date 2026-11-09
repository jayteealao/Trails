import type { EventType, LogEvent, LogLevel, RequestSettle } from '@warg/shared';
import {
  INTERNAL_API_KEY_HEADER,
  classifyError,
  createEvent,
  isIncompleteDegradation,
  isRequestErrorCode,
  isUserActionHint,
} from '@warg/shared';
import type { ErrorClassification } from '@warg/shared';
import type { WorkflowResult } from './types.js';

type ClassifiedError = ErrorClassification;

function fromErrorObject(error: string | Error): ClassifiedError | undefined {
  if (!(error instanceof Error)) return undefined;
  const value = (error as unknown as { classification?: ClassifiedError }).classification;
  if (!value) return undefined;
  return value;
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
        [INTERNAL_API_KEY_HEADER]: env.INTERNAL_API_KEY
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
        [INTERNAL_API_KEY_HEADER]: env.INTERNAL_API_KEY
      },
      body: JSON.stringify(settle),
      signal: AbortSignal.timeout(10_000),
    }
  );
  if (!response.ok) {
    const text = (await response.text()).slice(0, 300);
    throw new Error(`Logger settle answered ${response.status}: ${text}`);
  }
  // A stale settle lost to a newer run: the logger keeps the newer state, which is
  // right, but the log should show that this run's state was not applied.
  const answer: unknown = await response.json().catch(() => undefined);
  if (isStaleSettleAnswer(answer)) {
    console.warn(
      '[workflow] settle not applied: the logger holds a newer run',
      JSON.stringify({ request_id: requestId, state: settle.state, stage: answer.stage })
    );
  }
}

function isStaleSettleAnswer(value: unknown): value is { reason: 'stale'; stage?: unknown } {
  return typeof value === 'object' && value !== null && 'reason' in value && value.reason === 'stale';
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
          [INTERNAL_API_KEY_HEADER]: env.INTERNAL_API_KEY
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
