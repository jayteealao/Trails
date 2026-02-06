import { describe, it, expect, vi } from 'vitest';
import {
  generateRequestId,
  isValidArchiveUrl,
  withRequestId,
  createEvent
} from './util.js';

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

    const event = createEvent('request.created', 'info', 'test message');
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
    const event = createEvent('step.started', 'debug', 'step', { url: 'https://example.com' });
    expect(event.data).toEqual({ url: 'https://example.com' });
  });

  it('always sets source to gateway', () => {
    const event = createEvent('request.done', 'info', 'done');
    expect(event.source).toBe('gateway');
  });
});
