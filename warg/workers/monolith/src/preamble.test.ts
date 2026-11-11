import { describe, expect, it, vi } from 'vitest';
import { getSandbox } from '@cloudflare/sandbox';
import worker from './index.js';

vi.mock('@cloudflare/sandbox', () => ({
  getSandbox: vi.fn(),
  Sandbox: class {},
  ContainerProxy: class {},
  ContainerUnavailableError: class extends Error {}
}));

const bucket = { get: vi.fn(), put: vi.fn(), head: vi.fn() };
// The fake bindings carry only the methods the handler could reach; a request
// that is turned away must not reach a container or the bucket.
const env = { INTERNAL_API_KEY: 'test-key', Sandbox: {}, ARCHIVE_BUCKET: bucket } as unknown as Env;
const ctx = {} as ExecutionContext;

function req(method: string, path: string, key?: string, body = '{}'): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key !== undefined) headers['X-Internal-API-Key'] = key;
  return new Request(`https://monolith${path}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : body
  });
}

describe.each(['/monolith', '/container/stop'])('monolith internal request check on %s', (path) => {
  it.each([
    ['no key', () => req('POST', path), 401, { error: 'Unauthorized' }],
    ['a wrong key', () => req('POST', path, 'wrong-key'), 401, { error: 'Unauthorized' }],
    ['a GET with the key', () => req('GET', path, 'test-key'), 404, { error: 'Not found' }],
    ['an unknown path with no key', () => req('POST', '/other'), 404, { error: 'Not found' }],
    ['bad JSON with the key', () => req('POST', path, 'test-key', '{not json'), 400, { error: 'Invalid JSON' }]
  ])('answers %s with %i', async (_name, makeRequest, status, body) => {
    vi.clearAllMocks();

    const res = await worker.fetch(makeRequest(), env, ctx);

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
    expect(getSandbox).not.toHaveBeenCalled();
    expect(bucket.get).not.toHaveBeenCalled();
    expect(bucket.head).not.toHaveBeenCalled();
  });
});
