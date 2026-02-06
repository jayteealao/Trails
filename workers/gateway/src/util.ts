import type { LogEvent } from '@warg/shared';

/**
 * Generate a unique request ID (UUIDv4-like).
 */
export function generateRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Validate that a URL is http or https.
 */
export function isValidArchiveUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Wrap a response with the X-Request-Id correlation header.
 */
export function withRequestId(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Request-Id', requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

/**
 * Create a log event helper.
 */
export function createEvent(
  type: LogEvent['type'],
  level: LogEvent['level'],
  message: string,
  data?: Record<string, unknown>
): LogEvent {
  return {
    ts: new Date().toISOString(),
    source: 'gateway',
    type,
    level,
    message,
    data
  };
}
