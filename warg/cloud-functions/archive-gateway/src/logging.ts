import type { LogEvent, EventType, LogLevel, EventSource } from './types.js';
import { postGatewayInternalLog } from './gateway-client.js';

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'https://gateway.jayteealao.workers.dev';
const INTERNAL_API_KEY = process.env['INTERNAL_API_KEY'] ?? '';
const CF_ACCESS_CLIENT_ID = process.env['CF_ACCESS_CLIENT_ID'] ?? '';
const CF_ACCESS_CLIENT_SECRET = process.env['CF_ACCESS_CLIENT_SECRET'] ?? '';

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
        gatewayUrl: GATEWAY_URL,
        internalApiKey: INTERNAL_API_KEY,
        cfAccessClientId: CF_ACCESS_CLIENT_ID,
        cfAccessClientSecret: CF_ACCESS_CLIENT_SECRET,
      },
      { requestId, event }
    );
  } catch (err) {
    // Log to console but don't throw - logging should not block operations
    console.error('[logging] Error logging event:', err);
  }
}
