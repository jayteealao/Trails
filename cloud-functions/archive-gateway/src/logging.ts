import type { LogEvent, EventType, LogLevel, EventSource } from './types.js';

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'https://gateway.warg.workers.dev';
const INTERNAL_API_KEY = process.env['INTERNAL_API_KEY'] ?? '';

/**
 * Log an event to the gateway's internal log endpoint.
 * Events are forwarded to the logger worker for storage.
 *
 * This helper is used by cloud functions to emit events since they
 * cannot directly access the logger worker via service bindings.
 */
export async function logEvent(
  requestId: string,
  source: EventSource,
  type: EventType,
  message: string,
  data?: Record<string, unknown>,
  level: LogLevel = 'info'
): Promise<void> {
  const event: LogEvent = {
    ts: new Date().toISOString(),
    source,
    type,
    level,
    message,
    data
  };

  try {
    const response = await fetch(`${GATEWAY_URL}/internal/log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-API-Key': INTERNAL_API_KEY
      },
      body: JSON.stringify({ requestId, event })
    });

    if (!response.ok) {
      console.error(`[logging] Failed to log event: ${await response.text()}`);
    }
  } catch (err) {
    // Log to console but don't throw - logging should not block operations
    console.error('[logging] Error logging event:', err);
  }
}
