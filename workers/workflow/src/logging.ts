import type { LogEvent, EventType, LogLevel } from '@warg/shared';

/**
 * Create a log event for the workflow source.
 */
function createEvent(
  type: EventType,
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>
): LogEvent {
  return {
    ts: new Date().toISOString(),
    source: 'workflow',
    type,
    level,
    message,
    data
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
  const event = createEvent(type, level, message, data);

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
      console.error(`Failed to log event: ${await response.text()}`);
    }
  } catch (err) {
    // Log to console but don't throw - logging should not block workflow
    console.error('Error logging event:', err);
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
  return logStepCompleted(env, requestId, stepName, { duration_ms: durationMs, ...data });
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
  return logEvent(
    env,
    requestId,
    'step.failed',
    `Step failed: ${stepName}: ${errorMsg}`,
    { step: stepName, error: errorMsg, ...(stack ? { stack } : {}), ...data },
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
  bytes: number
): Promise<void> {
  return logEvent(env, requestId, 'artifact.written', `Artifact written: ${kind}`, {
    kind,
    r2Key,
    bytes
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
  return logEvent(
    env,
    requestId,
    'request.failed',
    `Request failed: ${errorMsg}`,
    { error: errorMsg, ...(stack ? { stack } : {}), ...data },
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
      console.error(`Failed to update manifest key: ${await response.text()}`);
    }
  } catch (err) {
    console.error('Error updating manifest key:', err);
  }
}
