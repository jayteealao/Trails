import type { LogEvent, EventType, LogLevel, EventSource } from './types.js';
import { postGatewayInternalLog } from './gateway-client.js';
import { GATEWAY_LOG_KEY, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET } from './secrets.js';

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
    await postGatewayInternalLog(
      {
        // Read per call: secrets are bound at run time, not at module load.
        gatewayUrl: process.env['GATEWAY_URL'] ?? 'https://gateway.jayteealao.workers.dev',
        // The gateway worker's own internal key, held under its own name so
        // the old shared function key can be destroyed without cutting logging.
        internalApiKey: GATEWAY_LOG_KEY.value(),
        cfAccessClientId: CF_ACCESS_CLIENT_ID.value(),
        cfAccessClientSecret: CF_ACCESS_CLIENT_SECRET.value(),
      },
      { requestId, event }
    );
  } catch (err) {
    // Log to console but don't throw - logging should not block operations
    console.error('[logging] Error logging event:', err);
  }
}
