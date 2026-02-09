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
 * Validate that a request_id is a valid UUID v4 or Firestore auto-generated ID (20-char alphanumeric).
 */
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIRESTORE_ID_RE = /^[a-zA-Z0-9]{20}$/;
export function isValidRequestId(id: string): boolean {
  return UUID_V4_RE.test(id) || FIRESTORE_ID_RE.test(id);
}

/**
 * Check if a hostname resolves to a private/reserved IP range.
 * Blocks SSRF attempts against internal services and cloud metadata endpoints.
 */
export function isPrivateHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();

  // Strip brackets from IPv6
  const unbracketed = lower.startsWith('[') && lower.endsWith(']')
    ? lower.slice(1, -1)
    : lower;

  // Loopback and special addresses
  if (
    unbracketed === 'localhost' ||
    unbracketed === '0.0.0.0' ||
    unbracketed === '::1' ||
    unbracketed === '::' ||
    unbracketed === '0:0:0:0:0:0:0:1' ||
    unbracketed === '0:0:0:0:0:0:0:0'
  ) {
    return true;
  }

  // IPv4-mapped IPv6 addresses (::ffff:127.0.0.1, ::ffff:10.0.0.1, etc.)
  const v4MappedMatch = unbracketed.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4MappedMatch) {
    return isPrivateIPv4(v4MappedMatch[1]!);
  }

  // Internal/local TLDs
  if (lower.endsWith('.local') || lower.endsWith('.internal')) {
    return true;
  }

  // Cloud metadata endpoints
  if (unbracketed === '169.254.169.254' || lower === 'metadata.google.internal') {
    return true;
  }

  // Reject non-standard IP encodings (octal 0177.0.0.1, hex 0x7f000001, decimal 2130706433)
  // Only allow standard dotted-decimal: exactly 4 groups of 1-3 digits with no leading zeros
  if (/^\d/.test(unbracketed)) {
    // If it looks numeric but isn't standard dotted-decimal, reject it
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(unbracketed)) {
      // Could be decimal integer, hex, or other non-standard encoding
      return true;
    }
    // Reject leading zeros in octets (octal bypass: 0177.0.0.01)
    const octets = unbracketed.split('.');
    if (octets.some((o) => o.length > 1 && o.startsWith('0'))) {
      return true;
    }
    return isPrivateIPv4(unbracketed);
  }

  // Any IPv6 address (contains colons) — block all to prevent bypasses
  if (unbracketed.includes(':')) {
    return true;
  }

  // Bare hostnames (no dots) could be service binding names
  if (!lower.includes('.') && lower !== 'localhost') {
    return true;
  }

  return false;
}

/**
 * Check if a standard dotted-decimal IPv4 address is in a private/reserved range.
 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.some((p) => p > 255 || p < 0 || isNaN(p))) return true;
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

