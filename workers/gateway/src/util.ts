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
 * Validate that a request_id is a valid UUID v4.
 */
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isValidRequestId(id: string): boolean {
  return UUID_V4_RE.test(id);
}

/**
 * Check if a hostname resolves to a private/reserved IP range.
 * Blocks SSRF attempts against internal services and cloud metadata endpoints.
 */
function isPrivateHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();

  // Loopback and special addresses
  if (
    lower === 'localhost' ||
    lower === '0.0.0.0' ||
    lower === '::1' ||
    lower === '[::1]'
  ) {
    return true;
  }

  // Internal/local TLDs
  if (lower.endsWith('.local') || lower.endsWith('.internal')) {
    return true;
  }

  // Cloud metadata endpoints
  if (lower === '169.254.169.254' || lower === 'metadata.google.internal') {
    return true;
  }

  // Check numeric IPv4 patterns
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(lower)) {
    const parts = lower.split('.').map(Number);
    // 127.0.0.0/8 (loopback)
    if (parts[0] === 127) return true;
    // 10.0.0.0/8 (private)
    if (parts[0] === 10) return true;
    // 172.16.0.0/12 (private)
    if (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) return true;
    // 192.168.0.0/16 (private)
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 169.254.0.0/16 (link-local)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 0.0.0.0/8
    if (parts[0] === 0) return true;
  }

  // Bare hostnames (no dots) could be service binding names
  if (!lower.includes('.') && lower !== 'localhost') {
    return true;
  }

  return false;
}

/**
 * Validate that a URL is http or https and does not target private/internal hosts.
 */
export function isValidArchiveUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    if (isPrivateHost(parsed.hostname)) {
      return false;
    }
    return true;
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
