import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';

// The handler takes its own env shape (with its secrets), not the generated one.
type HandlerEnv = Parameters<typeof worker.fetch>[1];

const bucket = { get: vi.fn(), put: vi.fn(), head: vi.fn() };
// The fake bucket carries only the methods the handler could reach; a request
// that is turned away must not touch the bucket or call the browser API.
const env = {
  INTERNAL_API_KEY: 'test-key',
  HYPERBROWSER_API_KEY: 'hb-key',
  ARCHIVE_BUCKET: bucket
} as unknown as HandlerEnv;

const PATH = '/render';

function req(method: string, path: string, key?: string, body = '{}'): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key !== undefined) headers['X-Internal-API-Key'] = key;
  return new Request(`https://hyperrenderer${path}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : body
  });
}

describe('hyperrenderer internal request check', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['no key', req('POST', PATH), 401, { error: 'Unauthorized' }],
    ['a wrong key', req('POST', PATH, 'wrong-key'), 401, { error: 'Unauthorized' }],
    ['a GET with the key', req('GET', PATH, 'test-key'), 404, { error: 'Not found' }],
    ['an unknown path with no key', req('POST', '/other'), 404, { error: 'Not found' }],
    ['bad JSON with the key', req('POST', PATH, 'test-key', '{not json'), 400, { error: 'Invalid JSON' }]
  ])('answers %s with %i', async (_name, request, status, body) => {
    vi.clearAllMocks();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await worker.fetch(request, env);

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(bucket.get).not.toHaveBeenCalled();
    expect(bucket.put).not.toHaveBeenCalled();
  });
});
