import { describe, expect, it, vi } from 'vitest';
import worker from './index.js';

const bucket = { get: vi.fn(), put: vi.fn(), head: vi.fn() };
// The fake bucket carries only the methods the handler could reach; the rest
// of the R2 surface is never touched before the request is accepted.
const env = { INTERNAL_API_KEY: 'test-key', ARCHIVE_BUCKET: bucket } as unknown as Env;
const ctx = {} as ExecutionContext;

const PATH = '/readability';

function req(method: string, path: string, key?: string, body = '{}'): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key !== undefined) headers['X-Internal-API-Key'] = key;
  return new Request(`https://readability${path}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : body
  });
}

describe('readability internal request check', () => {
  it.each([
    ['no key', req('POST', PATH), 401, { error: 'Unauthorized' }],
    ['a wrong key', req('POST', PATH, 'wrong-key'), 401, { error: 'Unauthorized' }],
    ['a GET with the key', req('GET', PATH, 'test-key'), 404, { error: 'Not found' }],
    ['an unknown path with no key', req('POST', '/other'), 404, { error: 'Not found' }],
    ['bad JSON with the key', req('POST', PATH, 'test-key', '{not json'), 400, { error: 'Invalid JSON' }]
  ])('answers %s with %i', async (_name, request, status, body) => {
    vi.clearAllMocks();

    const res = await worker.fetch(request, env, ctx);

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
    expect(bucket.get).not.toHaveBeenCalled();
    expect(bucket.put).not.toHaveBeenCalled();
    expect(bucket.head).not.toHaveBeenCalled();
  });
});
