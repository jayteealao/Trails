/// <reference types="node" />
import { timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, parse, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import worker from '../index';
import { compileRoute } from '../path-match';
import { matchHandlers, type RouteHandler } from '../router';
import { ROUTES, type DashboardEnv } from '../routes';

// The dashboard moved from Pages to a Worker. Pages derived its routes from
// the files in functions/; the Worker routes through the table in
// src/routes.ts. These checks prove the two agree: every function file is in
// the table at the route Pages gave it, every route reaches the same handler,
// the path matcher matches as the one Pages runs, and the sign-in middleware
// refuses an unauthenticated request before any handler or static file.

const FUNCTIONS_DIR = fileURLToPath(new URL('../../functions', import.meta.url));
const HANDLER_EXPORT = /^onRequest(Get|Post|Put|Patch|Delete|Options|Head)?$/;

interface DiskRoute {
  file: string;
  exportName: string;
  routePath: string;
  mountPath: string;
  method: string | undefined;
  isMiddleware: boolean;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : /\.(mjs|js|ts|tsx|jsx)$/.test(entry.name) ? [full] : [];
  });
}

// wrangler's generateConfigFromFileTree (wrangler 4.148.0), for the syntax
// the dashboard uses: `[name]` is `:name`, index and _middleware files take
// their folder's route, the mount path is the folder.
function toRoute(path: string): string {
  const url = '/' + path.split(/[\\/]/).filter((s) => s && s !== '.').join('/');
  return url.replace(/\[\[([^\]]+)\]\]/g, ':$1*').replace(/\[([^\]]+)\]/g, ':$1');
}

// The export names of a file, read the way wrangler reads them: an esbuild
// metafile of the file alone.
async function exportNames(file: string): Promise<string[]> {
  const result = await build({ entryPoints: [file], metafile: true, write: false, bundle: false, logLevel: 'silent' });
  return Object.values(result.metafile.outputs).flatMap((output) => output.exports);
}

async function diskRoutes(): Promise<DiskRoute[]> {
  const routes: DiskRoute[] = [];
  for (const file of walk(FUNCTIONS_DIR)) {
    const { dir: folder, name: base } = parse(relative(FUNCTIONS_DIR, file));
    const isMiddleware = base === '_middleware' || base === '_middleware_';
    const routeFile = isMiddleware || base === 'index' ? folder : join(folder, base);
    for (const exportName of await exportNames(file)) {
      const found = exportName.match(HANDLER_EXPORT);
      if (!found) continue;
      routes.push({
        file,
        exportName,
        routePath: toRoute(routeFile),
        mountPath: toRoute(folder),
        method: found[1]?.toUpperCase(),
        isMiddleware,
      });
    }
  }
  return routes;
}

const DISK = await diskRoutes();

// The path a browser would send for a route: each param filled in.
function samplePath(routePath: string): string {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, 'sample-$1');
}

function sampleParams(routePath: string): Record<string, string> {
  return Object.fromEntries([...routePath.matchAll(/:([A-Za-z0-9_]+)/g)].map(([, name = '']) => [name, `sample-${name}`]));
}

async function handlerOf(route: DiskRoute): Promise<unknown> {
  const mod = (await import(pathToFileURL(route.file).href)) as Record<string, unknown>;
  return mod[route.exportName];
}

const signIn = ROUTES.find((route) => route.routePath === '/')?.middlewares[0];
const moduleRoutes = DISK.filter((route) => !route.isMiddleware);

describe('the route table matches the function files on disk', () => {
  it('finds the root middleware and every function route', () => {
    expect(DISK.filter((route) => route.isMiddleware)).toHaveLength(1);
    expect(moduleRoutes.length).toBeGreaterThanOrEqual(16);
  });

  it('holds one entry per handler export, and nothing else', () => {
    const table = ROUTES.flatMap((route) => [
      ...route.middlewares.map(() => `${route.routePath} ${route.mountPath} ${route.method ?? '*'} middleware`),
      ...route.modules.map(() => `${route.routePath} ${route.mountPath} ${route.method ?? '*'} module`),
    ]);
    const disk = DISK.map(
      (route) =>
        `${route.routePath} ${route.mountPath} ${route.method ?? '*'} ${route.isMiddleware ? 'middleware' : 'module'}`,
    );
    expect([...table].sort()).toEqual([...disk].sort());
  });

  it.each(DISK.map((route) => [relative(FUNCTIONS_DIR, route.file), route] as const))(
    '%s is the handler of its route',
    async (_file, route) => {
      const entry = ROUTES.find(
        (r) => r.routePath === route.routePath && r.mountPath === route.mountPath && r.method === route.method,
      );
      const handlers: RouteHandler<DashboardEnv>[] = route.isMiddleware ? (entry?.middlewares ?? []) : (entry?.modules ?? []);
      expect(handlers).toEqual([await handlerOf(route)]);
    },
  );
});

describe('every route resolves to its own handler, after the sign-in middleware', () => {
  it.each(moduleRoutes.map((route) => [route.method ?? '*', route.routePath, route] as const))(
    '%s %s',
    async (_method, _path, route) => {
      const handler = await handlerOf(route);
      const method = route.method ?? 'GET';
      for (const path of [samplePath(route.routePath), samplePath(route.routePath) + '/']) {
        const matched = [...matchHandlers(ROUTES, method, path)];
        expect(matched.map((m) => m.handler)).toEqual([signIn, handler]);
        expect(matched[1]?.params).toEqual(sampleParams(route.routePath));
      }
    },
  );

  it('sends a method no route serves to the static assets, after the middleware', () => {
    const matched = [...matchHandlers(ROUTES, 'DELETE', '/api/stats')];
    expect(matched.map((m) => m.handler)).toEqual([signIn]);
  });

  it.each(['/', '/index.html', '/app.js', '/modules/api.js', '/inbox', '/articles/sample-id', '/api', '/api/a/b'])(
    'serves %s from the static assets, after the middleware',
    (path) => {
      expect([...matchHandlers(ROUTES, 'GET', path)].map((m) => m.handler)).toEqual([signIn]);
    },
  );
});

// --- The path matcher against the one Pages runs ---

type PagesMatch = (path: string, options: { end: boolean }) => (input: string) => false | { path: string; params: object };
const requireHere = createRequire(import.meta.url);
const requireFromWrangler = createRequire(requireHere.resolve('wrangler/package.json'));
const pagesMatch = (requireFromWrangler('path-to-regexp') as { match: PagesMatch }).match;
// The template escapes these before matching (pages-template-worker.ts).
const PAGES_ESCAPE = /[.+?^${}()|[\]\\]/g;

describe('the path matcher matches as path-to-regexp 6.3.0 under Pages', () => {
  it('compares against wrangler\'s own path-to-regexp 6', () => {
    expect((requireFromWrangler('path-to-regexp/package.json') as { version: string }).version).toBe('6.3.0');
  });

  const patterns = [...new Set(ROUTES.flatMap((route) => [route.routePath, route.mountPath]))];
  const paths = [
    ...new Set([
      ...ROUTES.map((route) => samplePath(route.routePath)),
      ...ROUTES.map((route) => samplePath(route.routePath) + '/'),
      ...ROUTES.map((route) => samplePath(route.routePath).toUpperCase()),
      ...ROUTES.map((route) => samplePath(route.routePath) + '/extra'),
      ...ROUTES.map((route) => samplePath(route.routePath) + '.json'),
      '/',
      '//',
      '',
      '/app.js',
      '/api',
      '/api/',
      '/apis',
      '/api/a%2Fb',
      '/api/a b',
      '/api/articles/x/retry-full/',
      '/api/stream/',
      '/api/stream//',
    ]),
  ];

  for (const end of [true, false]) {
    it.each(patterns)(`%s matches each path the same (end: ${end})`, (pattern) => {
      const ours = compileRoute(pattern, end);
      const theirs = pagesMatch(pattern.replace(PAGES_ESCAPE, '\\$&'), { end });
      for (const path of paths) {
        const expected = theirs(path);
        const actual = ours(path);
        expect(actual === false ? false : { path: actual.path, params: { ...actual.params } }, `${pattern} on ${path}`).toEqual(
          expected === false ? false : { path: expected.path, params: { ...expected.params } },
        );
      }
    });
  }

  it.each(['/api/[[path]]', '/api/:path*', '/api/(.*)', '/api/:id?'])('refuses route syntax it does not implement: %s', (pattern) => {
    expect(() => compileRoute(pattern, true)).toThrow(/does not support/);
  });
});

// --- The Worker refuses an unauthenticated request before any handler ---

const SECRET = 'e2e-user:e2e-pass';

function basic(credential: string): string {
  return 'Basic ' + btoa(credential);
}

// Test doubles for the bindings: only fetch is called. Fetcher also carries
// connect(), which nothing here uses, hence the casts.
function makeEnv(withSecret = true) {
  const binding = () => vi.fn(async () => new Response('{}', { status: 200 }));
  const logger = binding();
  const gateway = binding();
  const assets = vi.fn(async () => new Response('asset', { status: 200 }));
  const env: DashboardEnv = {
    ASSETS: { fetch: assets } as unknown as Fetcher,
    LOGGER: { fetch: logger } as unknown as Fetcher,
    GATEWAY: { fetch: gateway } as unknown as Fetcher,
    BACKFILL_STATUS_URL: 'http://127.0.0.1:1/backfillStatus',
    DASHBOARD_API_URL: 'http://127.0.0.1:1/dashboardApi',
    DASHBOARD_AUTH: withSecret ? SECRET : undefined,
    INTERNAL_API_KEY: 'internal',
    DASHBOARD_API_KEY: 'dashboard',
    BACKFILL_STATUS_KEY: 'backfill',
    CF_API_TOKEN: 'token',
    CF_ACCOUNT_ID: 'account',
  };
  return { env, logger, gateway, assets };
}

// Only waitUntil is read by the router; the rest of ExecutionContext is the
// runtime's own.
const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

function send(env: DashboardEnv, method: string, path: string, authorization?: string) {
  const headers = new Headers();
  if (authorization) headers.set('Authorization', authorization);
  const body = method === 'POST' ? '{}' : undefined;
  return worker.fetch(new Request('https://dashboard.example.com' + path, { method, headers, body }), env, ctx);
}

describe('the dashboard Worker', () => {
  const outbound = vi.fn(async () => new Response('{}', { status: 200 }));

  beforeAll(() => {
    // Node has no crypto.subtle.timingSafeEqual (a Workers runtime method).
    const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: unknown };
    if (typeof subtle.timingSafeEqual !== 'function') {
      Object.defineProperty(subtle, 'timingSafeEqual', {
        configurable: true,
        value: (a: ArrayBuffer, b: ArrayBuffer) => nodeTimingSafeEqual(Buffer.from(a), Buffer.from(b)),
      });
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    outbound.mockClear();
  });

  const requests = [
    ...moduleRoutes.map((route) => [route.method ?? 'GET', samplePath(route.routePath)] as const),
    ['GET', '/'],
    ['GET', '/index.html'],
    ['GET', '/app.js'],
    ['GET', '/inbox'],
    ['GET', '/articles/sample-id'],
  ] as const;

  describe.each(requests)('%s %s', (method, path) => {
    it('asks for sign-in and reaches no handler, binding or static file without a credential', async () => {
      vi.stubGlobal('fetch', outbound);
      const { env, logger, gateway, assets } = makeEnv();
      const response = await send(env, method, path);
      expect(response.status).toBe(401);
      expect(await response.text()).toBe('Sign-in required.');
      for (const spy of [logger, gateway, assets, outbound]) expect(spy).not.toHaveBeenCalled();
    });

    it('refuses a wrong credential the same way', async () => {
      vi.stubGlobal('fetch', outbound);
      const { env, logger, gateway, assets } = makeEnv();
      const response = await send(env, method, path, basic('e2e-user:wrong'));
      expect(response.status).toBe(401);
      for (const spy of [logger, gateway, assets, outbound]) expect(spy).not.toHaveBeenCalled();
    });

    it('fails closed with a 500 when no credential is configured', async () => {
      vi.stubGlobal('fetch', outbound);
      const { env, logger, gateway, assets } = makeEnv(false);
      const response = await send(env, method, path, basic(SECRET));
      expect(response.status).toBe(500);
      expect(await response.text()).toBe('Dashboard auth is not configured.');
      for (const spy of [logger, gateway, assets, outbound]) expect(spy).not.toHaveBeenCalled();
    });
  });

  it('runs the handler for a signed-in request, with its params', async () => {
    const { env, logger, assets } = makeEnv();
    const response = await send(env, 'GET', '/api/stream/abc-123', basic(SECRET));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger.mock.calls[0]).toEqual([
      'https://logger/request/abc-123/stream',
      expect.objectContaining({ headers: expect.objectContaining({ 'X-Internal-API-Key': 'internal' }) }),
    ]);
    expect(assets).not.toHaveBeenCalled();
  });

  it('serves a static file from the assets for a signed-in request', async () => {
    const { env, logger, assets } = makeEnv();
    const response = await send(env, 'GET', '/app.js', basic(SECRET));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('asset');
    expect(assets).toHaveBeenCalledTimes(1);
    expect(logger).not.toHaveBeenCalled();
  });
});
