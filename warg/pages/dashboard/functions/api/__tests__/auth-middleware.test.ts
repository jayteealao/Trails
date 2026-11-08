/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { listRoutes } from './route-inventory';

const API_DIR = fileURLToPath(new URL('..', import.meta.url));
const routes = listRoutes(API_DIR);

// The Pages router runs the root middleware for a request only when
// `match('/', { end: false })` matches its path, with the path matcher that
// wrangler itself loads. Resolve that matcher the way wrangler does.
type PathMatcher = { match: (path: string, options: { end: boolean }) => (input: string) => unknown };
const requireHere = createRequire(import.meta.url);
const requireFromWrangler = createRequire(requireHere.resolve('wrangler/package.json'));
const { match } = requireFromWrangler('path-to-regexp') as PathMatcher;

describe('Pages router covers every route with the root middleware', () => {
  it('finds every function route on disk', () => {
    expect(routes.length).toBeGreaterThanOrEqual(16);
  });

  it.each([...routes.map((route) => route.path), '/', '/app.js', '/index.html', '/articles/sample-id'])(
    'the root middleware runs for %s',
    (path) => {
      expect(match('/', { end: false })(path)).toBeTruthy();
    },
  );
});
