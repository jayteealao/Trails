import { describe, expect, it, vi } from 'vitest';
import puppeteer from '@cloudflare/puppeteer';
import worker from './index.js';

vi.mock('@cloudflare/puppeteer', () => ({
  default: { launch: vi.fn() }
}));

const bucket = { get: vi.fn(), put: vi.fn(), head: vi.fn() };
// The fake bindings carry only the methods the handler could reach; a request
// that is turned away must not open a browser or touch the bucket.
const env = { INTERNAL_API_KEY: 'test-key', ARCHIVE_BUCKET: bucket, MYBROWSER: {} } as unknown as Env;
const ctx = {} as ExecutionContext;

const PATH = '/singlefile';

function req(method: string, path: string, key?: string, body = '{}'): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key !== undefined) headers['X-Internal-API-Key'] = key;
  return new Request(`https://singlefile${path}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : body
  });
}

describe('singlefile internal request check', () => {
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
    expect(puppeteer.launch).not.toHaveBeenCalled();
    expect(bucket.get).not.toHaveBeenCalled();
    expect(bucket.put).not.toHaveBeenCalled();
  });
});
