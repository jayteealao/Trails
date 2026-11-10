/// <reference types="node" />
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { listRoutes } from './route-inventory';
import { onRequest } from '../../_middleware';

const API_DIR = fileURLToPath(new URL('..', import.meta.url));
const routes = listRoutes(API_DIR);

// That the dashboard Worker's router runs this middleware before every route
// and static file is checked in src/__tests__/router.test.ts.

// --- The sign-in check itself ---

const SECRET = 'e2e-user:e2e-pass';
const CHALLENGE = 'Basic realm="Warg dashboard", charset="UTF-8"';
const NOT_CONFIGURED = 'Dashboard auth is not configured.';
// Stands for a project with no sign-in secret bound at all.
const UNSET = Symbol('no secret bound');

// A Basic header for a credential, encoded as UTF-8 the way the browser sends it.
function basic(credential: string): string {
  const bytes = new TextEncoder().encode(credential);
  return 'Basic ' + btoa(String.fromCharCode(...bytes));
}

type MiddlewareContext = Parameters<typeof onRequest>[0];

async function run(
  path: string,
  method: string,
  authorization?: string,
  secret: string | typeof UNSET = SECRET,
  extraHeaders: Record<string, string> = {},
) {
  const headers = new Headers(extraHeaders);
  if (authorization !== undefined) headers.set('Authorization', authorization);
  const request = new Request('https://dashboard.example.com' + path, { method, headers });
  const next = vi.fn(async () => new Response('handler', { status: 299 }));
  // The test passes only the parts of the Pages context the check reads;
  // the full EventContext type also carries the runtime's own members.
  const context = {
    request,
    env: secret === UNSET ? {} : { DASHBOARD_AUTH: secret },
    next,
    params: {},
    data: {},
    waitUntil() {},
    passThroughOnException() {},
    functionPath: path,
  } as unknown as MiddlewareContext;
  const response = await onRequest(context);
  return { response, next };
}

const routeMethods = routes.flatMap((route) => route.methods.map((method) => ({ path: route.path, method })));

describe('dashboard sign-in check', () => {
  beforeAll(() => {
    // Node has no crypto.subtle.timingSafeEqual (a Workers runtime method);
    // stand in with node:crypto's, which has the same contract.
    const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: unknown };
    if (typeof subtle.timingSafeEqual !== 'function') {
      Object.defineProperty(subtle, 'timingSafeEqual', {
        configurable: true,
        value: (a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView) =>
          nodeTimingSafeEqual(toBuffer(a), toBuffer(b)),
      });
    }
  });

  it('checks every route and method found on disk', () => {
    expect(routeMethods.length).toBeGreaterThanOrEqual(16);
  });

  describe.each(routeMethods)('$method $path', ({ path, method }) => {
    it('asks for sign-in when no credential is sent', async () => {
      const { response, next } = await run(path, method);
      expect(response.status).toBe(401);
      expect(await response.text()).toBe('Sign-in required.');
      expect(response.headers.get('WWW-Authenticate')).toBe(CHALLENGE);
      expect(next).not.toHaveBeenCalled();
    });

    it('refuses a wrong password', async () => {
      const { response, next } = await run(path, method, basic('e2e-user:wrong'));
      expect(response.status).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('passes the right credential on to the handler', async () => {
      const { response, next } = await run(path, method, basic(SECRET));
      expect(next).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(299);
    });

    it('fails closed when no credential is configured', async () => {
      const { response, next } = await run(path, method, basic(SECRET), UNSET);
      expect(response.status).toBe(500);
      expect(await response.text()).toBe(NOT_CONFIGURED);
      expect(response.headers.get('WWW-Authenticate')).toBeNull();
      expect(response.headers.get('Content-Type')).toMatch(/^text\/plain/);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('credential edge cases', () => {
    const path = '/api/stats';

    it.each([
      ['a wrong user', basic('someone:e2e-pass')],
      ['another scheme', 'Bearer abc'],
      ['invalid base64', 'Basic !!!'],
      ['an empty token', 'Basic '],
      ['a much longer guess', basic(SECRET + 'x'.repeat(500))],
    ])('refuses %s', async (_label, authorization) => {
      const { response, next } = await run(path, 'GET', authorization);
      expect(response.status).toBe(401);
      expect(response.headers.get('WWW-Authenticate')).toBe(CHALLENGE);
      expect(next).not.toHaveBeenCalled();
    });

    it('accepts the scheme name in any case', async () => {
      const token = basic(SECRET).slice('Basic '.length);
      const { next } = await run(path, 'GET', 'basic ' + token);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('accepts a password holding a colon and a non-ASCII character', async () => {
      const secret = 'operator:pa:ss-wörd';
      const { next } = await run(path, 'GET', basic(secret), secret);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['unset', UNSET],
      ['empty', ''],
    ] as const)('fails closed when the credential is %s', async (_label, secret) => {
      for (const authorization of [undefined, basic(':')]) {
        const { response, next } = await run(path, 'GET', authorization, secret);
        expect(response.status).toBe(500);
        expect(await response.text()).toBe(NOT_CONFIGURED);
        expect(next).not.toHaveBeenCalled();
      }
    });
  });

  describe('writes started by another site', () => {
    const writes = routeMethods.filter(({ method }) => method !== 'GET');
    const reads = routeMethods.filter(({ method }) => method === 'GET');

    it('finds the write routes on disk', () => {
      expect(writes.length).toBeGreaterThanOrEqual(5);
    });

    it.each([
      ['another origin', { Origin: 'https://evil.example' }],
      ['an opaque origin', { Origin: 'null' }],
      ['a cross-site fetch', { 'Sec-Fetch-Site': 'cross-site' }],
      ['a same-site fetch from another host', { 'Sec-Fetch-Site': 'same-site' }],
      ['a cross-site fetch that claims the dashboard origin', { 'Sec-Fetch-Site': 'cross-site', Origin: 'https://dashboard.example.com' }],
    ])('refuses a signed-in write from %s', async (_label, extra) => {
      for (const { path, method } of writes) {
        const { response, next } = await run(path, method, basic(SECRET), SECRET, extra);
        expect(response.status, `${method} ${path}`).toBe(403);
        expect(await response.text()).toBe('Cross-site request refused.');
        expect(next).not.toHaveBeenCalled();
      }
    });

    it.each([
      ['the dashboard itself', { Origin: 'https://dashboard.example.com', 'Sec-Fetch-Site': 'same-origin' }],
      ['the dashboard origin alone', { Origin: 'https://dashboard.example.com' }],
      ['a typed address', { 'Sec-Fetch-Site': 'none' }],
      ['a client that is not a browser', {}],
    ])('passes a signed-in write from %s', async (_label, extra) => {
      for (const { path, method } of writes) {
        const { response, next } = await run(path, method, basic(SECRET), SECRET, extra);
        expect(response.status, `${method} ${path}`).toBe(299);
        expect(next).toHaveBeenCalledOnce();
      }
    });

    it('still passes a signed-in read from another site', async () => {
      for (const { path, method } of reads) {
        const { response } = await run(path, method, basic(SECRET), SECRET, { 'Sec-Fetch-Site': 'cross-site' });
        expect(response.status, `${method} ${path}`).toBe(299);
      }
    });

    it('asks for sign-in before it looks at the origin', async () => {
      const { path, method } = writes[0]!;
      const { response } = await run(path, method, undefined, SECRET, { Origin: 'https://evil.example' });
      expect(response.status).toBe(401);
    });
  });
});

function toBuffer(value: ArrayBuffer | ArrayBufferView): Buffer {
  return ArrayBuffer.isView(value)
    ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
    : Buffer.from(new Uint8Array(value));
}
