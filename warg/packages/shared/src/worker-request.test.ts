import { describe, expect, it } from 'vitest';
import { readInternalJsonRequest } from './worker-request.js';

const KEY = 'k';

function req(method: string, path: string, key?: string, body?: string): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key !== undefined) headers['X-Internal-API-Key'] = key;
  return new Request(`https://worker${path}`, { method, headers, body });
}

describe('readInternalJsonRequest turns a request away', () => {
  it.each([
    ['a wrong method', ['/x'], req('GET', '/x', KEY), 404, { error: 'Not found' }],
    ['an unknown path with no key', ['/x'], req('POST', '/y', undefined, '{}'), 404, { error: 'Not found' }],
    ['no key header', ['/x'], req('POST', '/x', undefined, '{}'), 401, { error: 'Unauthorized' }],
    ['a wrong key of the same length', ['/x'], req('POST', '/x', 'j', '{}'), 401, { error: 'Unauthorized' }],
    ['a wrong key of another length', ['/x'], req('POST', '/x', 'kk', '{}'), 401, { error: 'Unauthorized' }],
    ['bad JSON with the key', ['/x'], req('POST', '/x', KEY, '{not json'), 400, { error: 'Invalid JSON' }],
    ['an empty body with the key', ['/x'], req('POST', '/x', KEY, ''), 400, { error: 'Invalid JSON' }],
    ['a wrong method and no key (route first)', ['/x'], req('PUT', '/x', undefined, '{}'), 404, { error: 'Not found' }],
    ['no key and bad JSON (key before JSON)', ['/x'], req('POST', '/x', undefined, '{not json'), 401, { error: 'Unauthorized' }],
    ['a path outside two paths', ['/a', '/b'], req('POST', '/c', KEY, '{}'), 404, { error: 'Not found' }]
  ])('answers %s', async (_name, paths, request, status, body) => {
    const result = await readInternalJsonRequest(request, KEY, paths);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(status);
    expect(await result.response.json()).toEqual(body);
  });
});

describe('readInternalJsonRequest accepts a request', () => {
  it.each([
    ['the only path', ['/x'], '/x'],
    ['the first of two paths', ['/a', '/b'], '/a'],
    ['the second of two paths', ['/a', '/b'], '/b']
  ])('accepts %s with the parsed body and URL', async (_name, paths, path) => {
    const result = await readInternalJsonRequest(
      req('POST', path, KEY, JSON.stringify({ request_id: 'r1', n: 2 })),
      KEY,
      paths
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toEqual({ request_id: 'r1', n: 2 });
    expect(result.url.pathname).toBe(path);
  });
});
