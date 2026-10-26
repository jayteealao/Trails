import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error - dashboard runtime modules are plain JS and intentionally imported in tests.
import { fetchArticles } from '../../../modules/api.js';

// The list request: the unfiltered list sends the saved cursor for the page it
// asks for; a filtered or searched list, and page 1, never send one.

function stubFetch() {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ articles: [], total: 0, hasMore: false, nextCursor: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    })
  );
  return urls;
}

const query = (url: string) => new URL(url, 'https://dashboard.example.com').searchParams;

describe('fetchArticles cursor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the saved cursor for page 2 of the unfiltered list', async () => {
    const urls = stubFetch();
    await fetchArticles({ status: '', search: '' }, { page: 2, limit: 50, cursors: { 2: 'tok-2' } });
    const params = query(urls[0]!);
    expect(params.get('cursor')).toBe('tok-2');
    expect(params.get('page')).toBe('2');
    expect(params.get('limit')).toBe('50');
  });

  it('sends no cursor with a status filter or a search', async () => {
    const urls = stubFetch();
    await fetchArticles({ status: 'failed', search: '' }, { page: 2, limit: 50, cursors: { 2: 'tok-2' } });
    await fetchArticles({ status: '', search: 'example' }, { page: 2, limit: 50, cursors: { 2: 'tok-2' } });
    expect(query(urls[0]!).has('cursor')).toBe(false);
    expect(query(urls[0]!).get('filter')).toBe('failed');
    expect(query(urls[1]!).has('cursor')).toBe(false);
    expect(query(urls[1]!).get('search')).toBe('example');
  });

  it('never sends a cursor for page 1, nor for a page with no saved cursor', async () => {
    const urls = stubFetch();
    await fetchArticles({ status: '', search: '' }, { page: 1, limit: 50, cursors: { 1: 'tok-1' } });
    await fetchArticles({ status: '', search: '' }, { page: 3, limit: 50, cursors: { 2: 'tok-2' } });
    await fetchArticles({ status: '', search: '' }, { page: 2, limit: 50 });
    expect(urls.map((u) => query(u).has('cursor'))).toEqual([false, false, false]);
  });
});
