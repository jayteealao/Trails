import { describe, it, expect, vi } from 'vitest';
import {
  generateRequestId,
  isValidArchiveUrl,
  isPrivateHost,
  isValidRequestId,
  withRequestId
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

  it('rejects non-UUID strings', () => {
    expect(isValidRequestId('not-a-uuid')).toBe(false);
    expect(isValidRequestId('')).toBe(false);
    expect(isValidRequestId('../../../etc/passwd')).toBe(false);
    expect(isValidRequestId('a'.repeat(100))).toBe(false);
  });

  it('rejects UUID v1 format', () => {
    // v1 has version nibble "1" not "4"
    expect(isValidRequestId('550e8400-e29b-11d4-a716-446655440000')).toBe(false);
  });

  it('accepts alphanumeric IDs (8-40 chars)', () => {
    expect(isValidRequestId('abc12345678901234567')).toBe(true);  // 20 chars (Firestore)
    expect(isValidRequestId('Abc12345DEF901234567')).toBe(true);
    expect(isValidRequestId('ABCDEFGHIJKLMNOPQRST')).toBe(true);
    expect(isValidRequestId('01234567890123456789')).toBe(true);
    expect(isValidRequestId('abcd1234')).toBe(true);              // 8 chars (minimum)
  });

  it('accepts Pocket-style item IDs', () => {
    expect(isValidRequestId('Vk1N2zlexyGkB1')).toBe(true);       // 14 chars
    expect(isValidRequestId('Ab3Xp9QrTm2nYz')).toBe(true);       // 14 chars
  });

  it('rejects IDs shorter than 8 or longer than 40 chars', () => {
    expect(isValidRequestId('abc1234')).toBe(false);              // 7 chars
    expect(isValidRequestId('a'.repeat(41))).toBe(false);         // 41 chars
  });

  it('rejects alphanumeric IDs with special characters', () => {
    expect(isValidRequestId('abc12345678901234_67')).toBe(false);
    expect(isValidRequestId('abc12345678901234-67')).toBe(false);
    expect(isValidRequestId('abc12345678901234.67')).toBe(false);
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
