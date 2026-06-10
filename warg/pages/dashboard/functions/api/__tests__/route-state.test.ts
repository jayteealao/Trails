import { describe, it, expect } from 'vitest';
// @ts-expect-error - dashboard runtime modules are plain JS and intentionally imported in tests.
import { parseLocation, buildUrl, normalizeRouteState } from '../../../modules/route-state.js';

describe('route-state codec', () => {
  it('parses request detail path with from query', () => {
    const route = parseLocation(new URL('https://dashboard.example.com/requests/req_123?from=inbox'));

    expect(route.view).toBe('detail');
    expect(route.requestId).toBe('req_123');
    expect(route.from).toBe('inbox');
  });

  it('parses article detail path', () => {
    const route = parseLocation(new URL('https://dashboard.example.com/articles/item_456?from=requests'));

    expect(route.view).toBe('articleDetail');
    expect(route.itemId).toBe('item_456');
    expect(route.from).toBe('requests');
  });

  it('sanitizes malformed requests query params', () => {
    const route = parseLocation(
      new URL('https://dashboard.example.com/requests?offset=-20&sort=nope&dir=sideways')
    );

    expect(route.view).toBe('requests');
    expect(route.requests.offset).toBe(0);
    expect(route.requests.sort).toBe('created');
    expect(route.requests.dir).toBe('desc');
  });

  it('normalizes unknown path to inbox', () => {
    const route = parseLocation(new URL('https://dashboard.example.com/not-a-real-route'));

    expect(route.view).toBe('inbox');
  });

  it('build/parse roundtrip retains requests list state', () => {
    const input = normalizeRouteState({
      view: 'requests',
      requests: {
        domain: 'nytimes.com',
        status: 'failed',
        q: 'paywall',
        dateRange: '24h',
        offset: 50,
        sort: 'url',
        dir: 'asc',
      },
      articles: {
        status: '',
        search: '',
        page: 1,
      },
    });

    const url = buildUrl(input);
    const parsed = parseLocation(new URL(`https://dashboard.example.com${url}`));

    expect(parsed.view).toBe('requests');
    expect(parsed.requests.domain).toBe('nytimes.com');
    expect(parsed.requests.status).toBe('failed');
    expect(parsed.requests.q).toBe('paywall');
    expect(parsed.requests.dateRange).toBe('24h');
    expect(parsed.requests.offset).toBe(50);
    expect(parsed.requests.sort).toBe('url');
    expect(parsed.requests.dir).toBe('asc');
  });

  it('buildUrl preserves from query for detail routes', () => {
    const url = buildUrl({
      view: 'detail',
      requestId: 'abc123',
      from: 'inbox',
      requests: { offset: 0, sort: 'created', dir: 'desc' },
      articles: { page: 1 },
    });

    expect(url).toBe('/requests/abc123?from=inbox');
  });
});
