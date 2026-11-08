import { WORKFLOW_STEPS, type ArchiveOptions } from '@warg/shared';

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
 * Validate that a request_id is a valid UUID v4 or safe ID (1-40 chars).
 * Accepts: Firestore auto-generated IDs (20 chars alphanumeric),
 * Pocket item IDs (~14 chars, base64url with hyphens/underscores),
 * and short legacy Pocket numeric IDs (e.g. "54149", "0").
 * The charset is restricted to [a-zA-Z0-9_-] so IDs stay safe as R2 key
 * segments; length is the only thing relaxed from the old 8-char floor.
 */
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,40}$/;
export function isValidRequestId(id: string): boolean {
  return UUID_V4_RE.test(id) || SAFE_ID_RE.test(id);
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

/**
 * The one list of codes a gateway error response can carry. Each value equals its key.
 */
export const GATEWAY_ERROR_CODES = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_JSON: 'INVALID_JSON',
  INVALID_REQUEST_ID: 'INVALID_REQUEST_ID',
  INVALID_INPUT_URL: 'INVALID_INPUT_URL',
  REQUEST_ID_REQUIRED: 'REQUEST_ID_REQUIRED',
  REQUEST_NOT_FOUND: 'REQUEST_NOT_FOUND',
  STATUS_LOOKUP_FAILED: 'STATUS_LOOKUP_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  WORKFLOW_TRIGGER_FAILED: 'WORKFLOW_TRIGGER_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  INVALID_OPTIONS: 'INVALID_OPTIONS',
  OPTION_NOT_ALLOWED: 'OPTION_NOT_ALLOWED'
} as const;

/**
 * A code from GATEWAY_ERROR_CODES.
 */
export type GatewayErrorCode = (typeof GATEWAY_ERROR_CODES)[keyof typeof GATEWAY_ERROR_CODES];

/**
 * The fixed message of every 500; the raw exception text goes to the server log only.
 */
export const INTERNAL_ERROR_MESSAGE = 'Internal error';

/**
 * The id of an error response: the candidate when it is a valid request id,
 * otherwise a fresh correlation id. An invalid caller-supplied id is never echoed.
 */
export function errorIdFor(candidate: string | undefined): string {
  return candidate !== undefined && isValidRequestId(candidate) ? candidate : generateRequestId();
}

/**
 * Build an error response `{ ...extra, error, code, id }` with the id also in X-Request-Id.
 * `extra` is spread first, so it can never override error, code or id.
 */
export function errorResponse(
  status: number,
  code: GatewayErrorCode,
  message: string,
  id: string,
  extra: Record<string, unknown> = {}
): Response {
  return withRequestId(Response.json({ ...extra, error: message, code, id }, { status }), id);
}

/**
 * The largest archive options object the gateway stores, in UTF-8 bytes of its JSON.
 */
export const MAX_OPTIONS_BYTES = 16 * 1024;

/**
 * The archive option keys whose value must be a boolean when present.
 */
export const ARCHIVE_OPTION_BOOLEAN_KEYS = [
  'includeScreenshot',
  'includePdf',
  'includeMarkdown',
  'resumeFromCheckpoint',
  'dryRun'
] as const;

/**
 * The archive option keys a public-key caller may not send: only the internal key
 * chooses a dry run or the step list. Their presence, whatever the value, is refused.
 */
export const PUBLIC_ONLY_FORBIDDEN_OPTION_KEYS = ['dryRun', 'steps'] as const;

/**
 * Archive options as the gateway stores them: only known keys, each of the right type.
 * The url is optional here; the begin handler checks its presence and format.
 */
export type GatewayArchiveOptions = Omit<ArchiveOptions, 'url'> & { url?: string; dryRun?: boolean };

/**
 * True for a JSON object value: not null, not an array, not a primitive.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const BOOLEAN_KEYS: ReadonlySet<string> = new Set(ARCHIVE_OPTION_BOOLEAN_KEYS);
const STEP_NAMES: ReadonlySet<string> = new Set(WORKFLOW_STEPS);

/**
 * Check the types of the archive option fields and keep only the known keys.
 * Unknown keys are dropped and named in droppedKeys; the first wrong-typed field,
 * or a kept object over MAX_OPTIONS_BYTES, fails with a message naming it.
 */
export function validateArchiveOptions(
  fields: Record<string, unknown>
): { ok: true; options: GatewayArchiveOptions; droppedKeys: string[] } | { ok: false; message: string } {
  const options: Record<string, unknown> = {};
  const droppedKeys: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (key === 'url') {
      if (typeof value !== 'string') return { ok: false, message: 'url must be a string' };
    } else if (BOOLEAN_KEYS.has(key)) {
      if (typeof value !== 'boolean') return { ok: false, message: `${key} must be a boolean` };
    } else if (key === 'steps') {
      if (!Array.isArray(value) || !value.every((step) => typeof step === 'string' && STEP_NAMES.has(step))) {
        return { ok: false, message: `steps must be an array of ${WORKFLOW_STEPS.join(', ')}` };
      }
    } else {
      droppedKeys.push(key);
      continue;
    }
    options[key] = value;
  }
  if (new TextEncoder().encode(JSON.stringify(options)).byteLength > MAX_OPTIONS_BYTES) {
    return { ok: false, message: `options exceed ${MAX_OPTIONS_BYTES} bytes` };
  }
  return { ok: true, options: options as GatewayArchiveOptions, droppedKeys };
}

/**
 * The longest a public-key caller can hold a status stream open. Below the logger's own 2-minute cap.
 */
export const PUBLIC_STATUS_STREAM_MAX_MS = 60_000;

const LINE_FEED = 0x0a;

/**
 * Forward an SSE body chunk by chunk. At maxMs, write `event: timeout` with
 * { reason: 'stream_time_limit', limitMs }, close, and cancel the upstream; when the
 * upstream ends first, close. Cancelling the returned stream cancels the upstream.
 */
export function capEventStream(upstream: ReadableStream<Uint8Array>, maxMs: number): ReadableStream<Uint8Array> {
  const reader = upstream.getReader();
  // null, not undefined: the Workers clearTimeout takes number | null.
  let timer: ReturnType<typeof setTimeout> | null = null;
  let finished = false;
  // True when the last forwarded chunk did not end on a frame boundary (a blank line).
  let midFrame = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        const data = JSON.stringify({ reason: 'stream_time_limit', limitMs: maxMs });
        controller.enqueue(new TextEncoder().encode(`${midFrame ? '\n\n' : ''}event: timeout\ndata: ${data}\n\n`));
        controller.close();
        reader.cancel('stream time limit').catch((err: unknown) => {
          console.warn('[gateway] cancelling the capped upstream stream failed', err);
        });
      }, maxMs);
    },
    async pull(controller) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (err) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        controller.error(err);
        return;
      }
      if (finished) return;
      if (result.done) {
        finished = true;
        clearTimeout(timer);
        controller.close();
        return;
      }
      const chunk = result.value;
      if (chunk.length > 0) {
        midFrame = !(chunk.length >= 2 && chunk[chunk.length - 1] === LINE_FEED && chunk[chunk.length - 2] === LINE_FEED);
      }
      controller.enqueue(chunk);
    },
    cancel(reason) {
      finished = true;
      clearTimeout(timer);
      return reader.cancel(reason);
    }
  });
}
