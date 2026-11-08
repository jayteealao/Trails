import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  generateRequestId,
  isValidArchiveUrl,
  isPrivateHost,
  isValidRequestId,
  withRequestId,
  GATEWAY_ERROR_CODES,
  INTERNAL_ERROR_MESSAGE,
  errorIdFor,
  errorResponse,
  isPlainObject,
  validateArchiveOptions,
  MAX_OPTIONS_BYTES,
  ARCHIVE_OPTION_BOOLEAN_KEYS,
  PUBLIC_ONLY_FORBIDDEN_OPTION_KEYS,
  PUBLIC_STATUS_STREAM_MAX_MS,
  capEventStream,
  REQUEST_OWNER_METADATA_KEY,
  resolveRequestIdOwner,
  storedRequestIdOwner,
  LEGACY_REQUEST_OWNER,
  type CallerKind
} from './util.js';
import { createEvent } from '@warg/shared';

describe('generateRequestId', () => {
  it('returns a string matching UUID v4 format', () => {
    const id = generateRequestId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateRequestId()));
    expect(ids.size).toBe(50);
  });
});

describe('isValidArchiveUrl', () => {
  it('accepts http URLs', () => {
    expect(isValidArchiveUrl('http://example.com')).toBe(true);
  });

  it('accepts https URLs', () => {
    expect(isValidArchiveUrl('https://example.com/page?q=1')).toBe(true);
  });

  it('rejects ftp URLs', () => {
    expect(isValidArchiveUrl('ftp://example.com')).toBe(false);
  });

  it('rejects javascript: URLs', () => {
    expect(isValidArchiveUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidArchiveUrl('')).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(isValidArchiveUrl('not a url')).toBe(false);
  });

  // SSRF protection
  it('rejects localhost', () => {
    expect(isValidArchiveUrl('http://localhost')).toBe(false);
    expect(isValidArchiveUrl('http://localhost:8080')).toBe(false);
  });

  it('rejects loopback IPs', () => {
    expect(isValidArchiveUrl('http://127.0.0.1')).toBe(false);
    expect(isValidArchiveUrl('http://127.0.0.99')).toBe(false);
  });

  it('rejects private RFC1918 ranges', () => {
    expect(isValidArchiveUrl('http://10.0.0.1')).toBe(false);
    expect(isValidArchiveUrl('http://172.16.0.1')).toBe(false);
    expect(isValidArchiveUrl('http://172.31.255.255')).toBe(false);
    expect(isValidArchiveUrl('http://192.168.1.1')).toBe(false);
  });

  it('rejects link-local and cloud metadata', () => {
    expect(isValidArchiveUrl('http://169.254.169.254')).toBe(false);
    expect(isValidArchiveUrl('http://169.254.0.1')).toBe(false);
  });

  it('rejects IPv6 loopback', () => {
    expect(isValidArchiveUrl('http://[::1]')).toBe(false);
  });

  it('rejects bare hostnames (service binding names)', () => {
    expect(isValidArchiveUrl('http://logger')).toBe(false);
    expect(isValidArchiveUrl('http://workflow')).toBe(false);
  });

  it('rejects .local and .internal TLDs', () => {
    expect(isValidArchiveUrl('http://myapp.local')).toBe(false);
    expect(isValidArchiveUrl('http://metadata.google.internal')).toBe(false);
  });

  it('allows non-private 172.x addresses', () => {
    expect(isValidArchiveUrl('http://172.15.0.1')).toBe(true);
    expect(isValidArchiveUrl('http://172.32.0.1')).toBe(true);
  });

  it('allows public URLs', () => {
    expect(isValidArchiveUrl('https://www.example.com')).toBe(true);
    expect(isValidArchiveUrl('https://news.ycombinator.com')).toBe(true);
    expect(isValidArchiveUrl('http://8.8.8.8')).toBe(true);
  });

  // SSRF bypass vectors
  it('rejects IPv4-mapped IPv6 addresses', () => {
    expect(isValidArchiveUrl('http://[::ffff:127.0.0.1]')).toBe(false);
    expect(isValidArchiveUrl('http://[::ffff:10.0.0.1]')).toBe(false);
    expect(isValidArchiveUrl('http://[::ffff:169.254.169.254]')).toBe(false);
  });

  it('rejects all IPv6 addresses', () => {
    expect(isValidArchiveUrl('http://[::1]')).toBe(false);
    expect(isValidArchiveUrl('http://[0:0:0:0:0:0:0:1]')).toBe(false);
    expect(isValidArchiveUrl('http://[::ffff:192.168.1.1]')).toBe(false);
  });

  it('rejects octal IP encoding', () => {
    expect(isValidArchiveUrl('http://0177.0.0.1')).toBe(false); // 127.0.0.1
    expect(isValidArchiveUrl('http://012.0.0.1')).toBe(false); // 10.0.0.1
  });

  it('rejects non-standard IP formats', () => {
    expect(isValidArchiveUrl('http://2130706433')).toBe(false); // decimal 127.0.0.1
    expect(isValidArchiveUrl('http://0x7f000001')).toBe(false); // hex 127.0.0.1
  });
});

describe('isPrivateHost', () => {
  it('blocks loopback addresses', () => {
    expect(isPrivateHost('localhost')).toBe(true);
    expect(isPrivateHost('127.0.0.1')).toBe(true);
    expect(isPrivateHost('::1')).toBe(true);
    expect(isPrivateHost('[::1]')).toBe(true);
    expect(isPrivateHost('0:0:0:0:0:0:0:1')).toBe(true);
  });

  it('blocks IPv4-mapped IPv6 private addresses', () => {
    expect(isPrivateHost('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateHost('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateHost('::ffff:192.168.1.1')).toBe(true);
  });

  it('blocks octal-encoded IPs', () => {
    expect(isPrivateHost('0177.0.0.1')).toBe(true);
    expect(isPrivateHost('012.0.0.1')).toBe(true);
  });

  it('blocks non-dotted-decimal numeric formats', () => {
    expect(isPrivateHost('2130706433')).toBe(true);
    expect(isPrivateHost('0x7f000001')).toBe(true);
  });

  it('blocks invalid octets', () => {
    expect(isPrivateHost('256.0.0.1')).toBe(true);
  });

  it('allows public hostnames', () => {
    expect(isPrivateHost('example.com')).toBe(false);
    expect(isPrivateHost('www.google.com')).toBe(false);
  });

  it('allows public IPs', () => {
    expect(isPrivateHost('8.8.8.8')).toBe(false);
    expect(isPrivateHost('1.1.1.1')).toBe(false);
    expect(isPrivateHost('172.32.0.1')).toBe(false);
  });
});

describe('isValidRequestId', () => {
  it('accepts valid UUID v4', () => {
    expect(isValidRequestId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isValidRequestId('6ba7b810-9dad-41d1-80b4-00c04fd430c8')).toBe(true);
  });

  it('accepts generated request IDs', () => {
    const id = generateRequestId();
    expect(isValidRequestId(id)).toBe(true);
  });

  it('rejects invalid strings', () => {
    expect(isValidRequestId('')).toBe(false);                     // empty
    expect(isValidRequestId('../../../etc/passwd')).toBe(false);  // dots and slashes
    expect(isValidRequestId('a'.repeat(100))).toBe(false);        // too long
  });

  it('accepts safe short hyphenated IDs (previously rejected)', () => {
    // 'not-a-uuid' is 10 chars of [a-z-] — valid under relaxed rules
    expect(isValidRequestId('not-a-uuid')).toBe(true);
    // UUID v1 is 36 chars of [0-9a-f-] — valid under relaxed rules
    expect(isValidRequestId('550e8400-e29b-11d4-a716-446655440000')).toBe(true);
  });

  it('accepts alphanumeric IDs (1-40 chars)', () => {
    expect(isValidRequestId('abc12345678901234567')).toBe(true);  // 20 chars (Firestore)
    expect(isValidRequestId('Abc12345DEF901234567')).toBe(true);
    expect(isValidRequestId('ABCDEFGHIJKLMNOPQRST')).toBe(true);
    expect(isValidRequestId('01234567890123456789')).toBe(true);
    expect(isValidRequestId('abcd1234')).toBe(true);              // 8 chars
  });

  it('accepts Pocket-style item IDs (base64url with hyphens/underscores)', () => {
    expect(isValidRequestId('Vk1N2zlexyGkB1')).toBe(true);       // 14 chars
    expect(isValidRequestId('Ab3Xp9QrTm2nYz')).toBe(true);       // 14 chars
    expect(isValidRequestId('--sXdODznPvlco')).toBe(true);        // starts with --
    expect(isValidRequestId('-1eylBHpm-jV-l')).toBe(true);        // multiple hyphens
    expect(isValidRequestId('-4OJ19CJdt89_A')).toBe(true);        // underscore
    expect(isValidRequestId('-D_whhy04nrNwD')).toBe(true);        // hyphen + underscore
  });

  it('rejects empty and over-length IDs', () => {
    expect(isValidRequestId('')).toBe(false);                     // 0 chars
    expect(isValidRequestId('a'.repeat(41))).toBe(false);         // 41 chars
  });

  it('accepts short legacy Pocket numeric IDs (1-7 chars)', () => {
    // Previously rejected by the 8-char floor, which caused gateway 400s and
    // abandoned backfill items (e.g. martinfowler.com id 54149, billjings.net id 0).
    expect(isValidRequestId('54149')).toBe(true);                 // 5 chars
    expect(isValidRequestId('0')).toBe(true);                     // 1 char
    expect(isValidRequestId('abc1234')).toBe(true);               // 7 chars
  });

  it('rejects IDs with disallowed special characters', () => {
    expect(isValidRequestId('abc12345678901234.67')).toBe(false); // dots
    expect(isValidRequestId('abc123456789 1234567')).toBe(false); // spaces
    expect(isValidRequestId('abc12345678@1234567')).toBe(false);  // @
  });
});

describe('withRequestId', () => {
  it('adds X-Request-Id header to response', () => {
    const original = new Response('body', { status: 200 });
    const wrapped = withRequestId(original, 'req-123');
    expect(wrapped.headers.get('X-Request-Id')).toBe('req-123');
  });

  it('preserves original status', () => {
    const original = new Response(null, { status: 201 });
    const wrapped = withRequestId(original, 'req-456');
    expect(wrapped.status).toBe(201);
  });

  it('preserves existing headers', () => {
    const original = new Response(null, {
      headers: { 'Content-Type': 'application/json' }
    });
    const wrapped = withRequestId(original, 'req-789');
    expect(wrapped.headers.get('Content-Type')).toBe('application/json');
    expect(wrapped.headers.get('X-Request-Id')).toBe('req-789');
  });
});

describe('createEvent', () => {
  it('returns a LogEvent with correct fields', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));

    const event = createEvent('gateway', 'request.created', 'info', 'test message');
    expect(event).toEqual({
      ts: '2025-01-15T12:00:00.000Z',
      source: 'gateway',
      type: 'request.created',
      level: 'info',
      message: 'test message',
      data: undefined
    });

    vi.useRealTimers();
  });

  it('includes optional data', () => {
    const event = createEvent('gateway', 'step.started', 'debug', 'step', { url: 'https://example.com' });
    expect(event.data).toEqual({ url: 'https://example.com' });
  });

  it('always sets source to gateway', () => {
    const event = createEvent('gateway', 'request.done', 'info', 'done');
    expect(event.source).toBe('gateway');
  });
});

describe('errorResponse', () => {
  it('returns { error, code, id } with the given status', async () => {
    const response = errorResponse(400, GATEWAY_ERROR_CODES.INVALID_JSON, 'Invalid JSON', 'req-1');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid JSON', code: 'INVALID_JSON', id: 'req-1' });
  });

  it('sets X-Request-Id to the body id', async () => {
    const response = errorResponse(404, GATEWAY_ERROR_CODES.NOT_FOUND, 'Not found', 'abc12345');
    const body = (await response.json()) as { id: string };
    expect(response.headers.get('X-Request-Id')).toBe(body.id);
  });

  it('adds extra fields but never lets them override error, code or id', async () => {
    const response = errorResponse(502, GATEWAY_ERROR_CODES.WORKFLOW_TRIGGER_FAILED, 'Workflow trigger failed', 'req-2', {
      workflowStatus: 500,
      error: 'override',
      code: 'OVERRIDE',
      id: 'other'
    });
    expect(await response.json()).toEqual({
      workflowStatus: 500,
      error: 'Workflow trigger failed',
      code: 'WORKFLOW_TRIGGER_FAILED',
      id: 'req-2'
    });
  });

  it('is served as application/json', () => {
    const response = errorResponse(500, GATEWAY_ERROR_CODES.INTERNAL_ERROR, INTERNAL_ERROR_MESSAGE, 'req-3');
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });
});

describe('errorIdFor', () => {
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('returns a valid request id as-is', () => {
    expect(errorIdFor('abc12345')).toBe('abc12345');
  });

  it.each([undefined, '', 'bad id!'])('returns a fresh UUID v4 for %j', (candidate) => {
    const id = errorIdFor(candidate);
    expect(id).toMatch(UUID_V4);
    expect(id).not.toBe(candidate);
  });
});

describe('GATEWAY_ERROR_CODES', () => {
  it('has every value equal to its key', () => {
    for (const [key, value] of Object.entries(GATEWAY_ERROR_CODES)) {
      expect(value).toBe(key);
    }
  });
});

describe('isPlainObject', () => {
  it('is true for an object literal', () => {
    expect(isPlainObject({})).toBe(true);
  });

  it.each([[null], [[]], ['x'], [1]])('is false for %j', (value) => {
    expect(isPlainObject(value)).toBe(false);
  });
});

describe('validateArchiveOptions', () => {
  const url = 'https://example.com/article';

  it.each([
    {},
    { url },
    { url, steps: [] },
    { url, steps: ['render', 'monolith'] }
  ])('accepts %j', (fields) => {
    const result = validateArchiveOptions(fields);
    expect(result).toEqual({ ok: true, options: fields, droppedKeys: [] });
  });

  it.each(ARCHIVE_OPTION_BOOLEAN_KEYS.flatMap((key) => [true, false].map((value) => ({ key, value }))))(
    'accepts $key = $value',
    ({ key, value }) => {
      const result = validateArchiveOptions({ url, [key]: value });
      expect(result).toEqual({ ok: true, options: { url, [key]: value }, droppedKeys: [] });
    }
  );

  it.each([
    { fields: { url: 123 }, field: 'url' },
    { fields: { url, includePdf: 'yes' }, field: 'includePdf' },
    { fields: { url, includeScreenshot: 1 }, field: 'includeScreenshot' },
    { fields: { url, dryRun: 'true' }, field: 'dryRun' },
    { fields: { url, steps: 'render' }, field: 'steps' },
    { fields: { url, steps: ['bogus'] }, field: 'steps' },
    { fields: { url, steps: [1] }, field: 'steps' },
    { fields: { url, steps: {} }, field: 'steps' }
  ])('rejects $fields with a message naming $field', ({ fields, field }) => {
    const result = validateArchiveOptions(fields);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(field);
  });

  it('accepts options exactly at MAX_OPTIONS_BYTES and rejects one byte over', () => {
    // '{"url":""}' is 10 bytes, so the url fills the rest of the limit.
    const atLimit = 'https://e.com/' + 'a'.repeat(MAX_OPTIONS_BYTES - 10 - 'https://e.com/'.length);
    expect(new TextEncoder().encode(JSON.stringify({ url: atLimit })).byteLength).toBe(MAX_OPTIONS_BYTES);
    expect(validateArchiveOptions({ url: atLimit }).ok).toBe(true);

    const overLimit = validateArchiveOptions({ url: atLimit + 'a' });
    expect(overLimit.ok).toBe(false);
    if (!overLimit.ok) expect(overLimit.message).toContain(String(MAX_OPTIONS_BYTES));
  });

  it('drops unknown keys, names them, and leaves them out of the options', () => {
    const result = validateArchiveOptions({ url, foo: 1, options: {} });
    expect(result).toEqual({ ok: true, options: { url }, droppedKeys: ['foo', 'options'] });
  });

  it('gives the same result for the same input every time', () => {
    const fields = { url, includePdf: true, steps: ['readability'], extra: 'x' };
    expect(validateArchiveOptions(fields)).toEqual(validateArchiveOptions(fields));
  });
});

describe('GATEWAY_ERROR_CODES.INVALID_OPTIONS', () => {
  it('equals its key', () => {
    expect(GATEWAY_ERROR_CODES.INVALID_OPTIONS).toBe('INVALID_OPTIONS');
  });
});

describe('GATEWAY_ERROR_CODES.OPTION_NOT_ALLOWED', () => {
  it('equals its key', () => {
    expect(GATEWAY_ERROR_CODES.OPTION_NOT_ALLOWED).toBe('OPTION_NOT_ALLOWED');
  });
});

describe('PUBLIC_ONLY_FORBIDDEN_OPTION_KEYS', () => {
  it('names dryRun and steps, both known option keys', () => {
    expect([...PUBLIC_ONLY_FORBIDDEN_OPTION_KEYS]).toEqual(['dryRun', 'steps']);
    for (const key of PUBLIC_ONLY_FORBIDDEN_OPTION_KEYS) {
      expect(validateArchiveOptions({ [key]: key === 'dryRun' ? true : [] }).ok).toBe(true);
    }
  });
});

describe('capEventStream', () => {
  const encoder = new TextEncoder();
  const END_EVENT = 'event: timeout\ndata: {"reason":"stream_time_limit","limitMs":60000}\n\n';

  /** An upstream SSE body the test drives, with a spy on its cancel. */
  function upstream() {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
      cancel
    });
    return {
      stream,
      cancel,
      send: (text: string) => controller.enqueue(encoder.encode(text)),
      end: () => controller.close()
    };
  }

  /** Read a stream in the background; `text` and `done` show what arrived so far. */
  function drain(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const state = { text: '', done: false };
    void (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          state.done = true;
          return;
        }
        state.text += decoder.decode(value, { stream: true });
      }
    })();
    return state;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is below the two minutes the logger holds a stream', () => {
    expect(PUBLIC_STATUS_STREAM_MAX_MS).toBe(60_000);
    expect(PUBLIC_STATUS_STREAM_MAX_MS).toBeLessThan(2 * 60 * 1000);
  });

  it('forwards upstream chunks unchanged', async () => {
    const up = upstream();
    const out = drain(capEventStream(up.stream, PUBLIC_STATUS_STREAM_MAX_MS));
    up.send('event: init\ndata: {"a":1}\n\n');
    up.send('event: log\ndata: {"b":2}\n\n');
    await vi.advanceTimersByTimeAsync(0);

    expect(out.text).toBe('event: init\ndata: {"a":1}\n\nevent: log\ndata: {"b":2}\n\n');
    expect(out.done).toBe(false);
  });

  it('ends an open stream with the timeout event at the cap, not one ms earlier', async () => {
    const up = upstream();
    const out = drain(capEventStream(up.stream, PUBLIC_STATUS_STREAM_MAX_MS));
    up.send('event: init\ndata: {}\n\n');

    await vi.advanceTimersByTimeAsync(PUBLIC_STATUS_STREAM_MAX_MS - 1);
    expect(out.text).toBe('event: init\ndata: {}\n\n');
    expect(out.done).toBe(false);
    expect(up.cancel).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(out.text).toBe('event: init\ndata: {}\n\n' + END_EVENT);
    expect(out.done).toBe(true);
    expect(up.cancel).toHaveBeenCalledTimes(1);
  });

  it('closes when the upstream ends first and writes nothing at the cap', async () => {
    const up = upstream();
    const out = drain(capEventStream(up.stream, PUBLIC_STATUS_STREAM_MAX_MS));
    up.send('event: done\ndata: {}\n\n');
    up.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(out.done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(PUBLIC_STATUS_STREAM_MAX_MS * 2);
    expect(out.text).toBe('event: done\ndata: {}\n\n');
    expect(up.cancel).not.toHaveBeenCalled();
  });

  it('ends a frame cut in the middle before the timeout event', async () => {
    const up = upstream();
    const out = drain(capEventStream(up.stream, PUBLIC_STATUS_STREAM_MAX_MS));
    up.send('data: {"a"');
    await vi.advanceTimersByTimeAsync(PUBLIC_STATUS_STREAM_MAX_MS);

    expect(out.text).toBe('data: {"a"\n\n' + END_EVENT);
    expect(out.done).toBe(true);
  });

  it('cancelling the capped stream cancels the upstream and clears the timer', async () => {
    const up = upstream();
    const capped = capEventStream(up.stream, PUBLIC_STATUS_STREAM_MAX_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);

    await capped.cancel('client gone');
    expect(up.cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('resolveRequestIdOwner', () => {
  it.each<[string | undefined, CallerKind, boolean, CallerKind | undefined]>([
    [undefined, 'public', true, 'public'],
    [undefined, 'internal', true, 'internal'],
    ['public', 'public', true, 'public'],
    ['internal', 'internal', true, 'internal'],
    ['public', 'internal', true, 'public'],
    ['internal', 'public', false, undefined],
    ['someone-else', 'public', false, undefined]
  ])('stored owner %j, caller %j -> ok %j, owner %j', (stored, caller, ok, owner) => {
    const result = resolveRequestIdOwner(stored, caller);
    expect(result.ok).toBe(ok);
    if (result.ok) {
      expect(result.owner).toBe(owner);
    }
  });
});

describe('storedRequestIdOwner', () => {
  it('is undefined when no options object exists', () => {
    expect(storedRequestIdOwner(null)).toBeUndefined();
  });

  it('reads the recorded owner', () => {
    expect(storedRequestIdOwner({ customMetadata: { owner: 'internal' } })).toBe('internal');
  });

  it('gives an object stored without an owner to the public key', () => {
    expect(storedRequestIdOwner({ customMetadata: {} })).toBe(LEGACY_REQUEST_OWNER);
    expect(storedRequestIdOwner({})).toBe('public');
  });
});

describe('request id ownership constants', () => {
  it('has the REQUEST_ID_CONFLICT code', () => {
    expect(GATEWAY_ERROR_CODES.REQUEST_ID_CONFLICT).toBe('REQUEST_ID_CONFLICT');
  });

  it('stores the owner under the owner metadata key', () => {
    expect(REQUEST_OWNER_METADATA_KEY).toBe('owner');
  });
});
