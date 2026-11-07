import { describe, it, expect } from 'vitest';
import { isChallengePage, isProxyErrorPage } from './render-content.js';
import {
  ARTICLE_ABOUT_CHALLENGES,
  CLOUDFLARE_CHALLENGE_PAGE,
  DATADOME_CHALLENGE_PAGE,
  LONG_PAGE_WITH_VENDOR_SENSOR,
  NORMAL_ARTICLE_PAGE,
  PERIMETERX_CHALLENGE_PAGE,
  THIN_PAGE_WITH_CLOUDFLARE_SCRIPT,
  THIN_PAGE_WITH_VERSIONED_CLOUDFLARE_SCRIPT,
  DEAD_HOST_STUB,
  DEAD_HOST_STUB_NO_TRAILING_NODE,
} from './challenge-page.fixtures.js';

describe('isProxyErrorPage', () => {
  it('rejects the observed dead-host proxy stub, trailing empty node and all', () => {
    expect(isProxyErrorPage(DEAD_HOST_STUB)).toBe(true);
  });

  it('rejects the same dead-host stub without its trailing empty node', () => {
    expect(isProxyErrorPage(DEAD_HOST_STUB_NO_TRAILING_NODE)).toBe(true);
  });

  it('still accepts a page whose non-pre sibling actually has content', () => {
    const page =
      '<html><body><pre>dial tcp: no such host</pre>' +
      '<div id="footer">Posted by the author</div></body></html>';
    expect(isProxyErrorPage(page)).toBe(false);
  });

  it('rejects other network-error shapes in the same bare-pre form', () => {
    for (const message of [
      'net::ERR_CONNECTION_REFUSED',
      'connection reset by peer',
      'dial tcp 10.0.0.1:443: i/o timeout',
      'read tcp: connection closed',
    ]) {
      const page = `<html><body><pre>${message}</pre></body></html>`;
      expect(isProxyErrorPage(page), message).toBe(true);
    }
  });

  it('accepts a short but legitimate page', () => {
    const page =
      '<html><head><title>Note</title></head><body>' +
      '<h1>XCOM 2</h1><p>A short post, but a real one.</p>' +
      '</body></html>';
    expect(isProxyErrorPage(page)).toBe(false);
  });

  it('accepts an article whose prose quotes a network error string', () => {
    const page =
      '<html><body><article><h1>Debugging flaky fetches</h1>' +
      '<p>The browser reported <code>net::ERR_CONNECTION_RESET</code> ' +
      'and the request never completed.</p>' +
      '<pre>dial tcp: lookup example.com on 1.1.1.1:53: no such host</pre>' +
      '</article></body></html>';
    expect(isProxyErrorPage(page)).toBe(false);
  });

  it('accepts a code-listing page whose only content is a pre with ordinary code', () => {
    const page =
      '<html><body><pre>function add(a, b) { return a + b; }</pre></body></html>';
    expect(isProxyErrorPage(page)).toBe(false);
  });

  it('accepts a long plain-text document that merely mentions a network error', () => {
    // A raw log or `.txt` article renders as a bare <pre> exactly like the
    // proxy stub does; only its length tells the two apart.
    const lines = Array.from(
      { length: 200 },
      (_, i) => `2026-09-04 12:00:${i} INFO request handled`,
    );
    lines.push('2026-09-04 12:05:00 WARN upstream timed out after 30s');
    const log = lines.join('\n');
    const page = `<html><body><pre style="white-space: pre-wrap;">${log}</pre></body></html>`;
    expect(isProxyErrorPage(page)).toBe(false);
  });

  it('rejects empty and whitespace-only input', () => {
    expect(isProxyErrorPage('')).toBe(true);
    expect(isProxyErrorPage('   \n\t  ')).toBe(true);
  });

  it('rejects a bare pre error page with no html or body wrapper', () => {
    expect(isProxyErrorPage('<pre>dial tcp: no such host</pre>')).toBe(true);
  });

  it('ignores comments and script/style noise around the error pre', () => {
    const page =
      '<html><body><!-- proxy --><style>pre{color:red}</style>' +
      '<pre>no such host</pre></body></html>';
    expect(isProxyErrorPage(page)).toBe(true);
  });
});

describe('isChallengePage', () => {
  it('flags the Cloudflare managed challenge page', () => {
    expect(isChallengePage(CLOUDFLARE_CHALLENGE_PAGE)).toBe(true);
  });

  it('flags the DataDome challenge page', () => {
    expect(isChallengePage(DATADOME_CHALLENGE_PAGE)).toBe(true);
  });

  it('flags the PerimeterX challenge page, which has no visible text', () => {
    expect(isChallengePage(PERIMETERX_CHALLENGE_PAGE)).toBe(true);
  });

  it('accepts an article that quotes the challenge words and markers as text', () => {
    expect(isChallengePage(ARTICLE_ABOUT_CHALLENGES)).toBe(false);
  });

  it('accepts a thin real page that only carries the Cloudflare bot-score injector', () => {
    expect(isChallengePage(THIN_PAGE_WITH_CLOUDFLARE_SCRIPT)).toBe(false);
  });

  it('accepts a thin real page whose Cloudflare injector uses the versioned /h/ path', () => {
    expect(isChallengePage(THIN_PAGE_WITH_VERSIONED_CLOUDFLARE_SCRIPT)).toBe(false);
  });

  it('accepts a long article whose site loads vendor bot sensors', () => {
    expect(isChallengePage(LONG_PAGE_WITH_VENDOR_SENSOR)).toBe(false);
  });

  it('accepts a plain article with no vendor markup', () => {
    expect(isChallengePage(NORMAL_ARTICLE_PAGE)).toBe(false);
  });

  it.each(['<script ', '<style ', '<!--', '<noscript ', '<a'])(
    'answers in linear time on 1 MB of unclosed %s tokens',
    (token) => {
      const filler = token.repeat(Math.floor(1_000_000 / token.length));
      const hostile = `<html><body><p>window._cf_chl_opt</p><div data-x="${filler}"></div></body></html>`;
      const start = Date.now();
      isChallengePage(hostile);
      expect(Date.now() - start).toBeLessThan(1_000);
    }
  );

  it('does not scan a large page for a proxy error', () => {
    expect(isProxyErrorPage('<html><body><pre>dial tcp: no such host</pre>' + '<div></div>'.repeat(5_000) + '</body></html>')).toBe(false);
  });

  it('leaves every recorded page to this check rather than the proxy-error check', () => {
    const pages = [
      CLOUDFLARE_CHALLENGE_PAGE,
      DATADOME_CHALLENGE_PAGE,
      PERIMETERX_CHALLENGE_PAGE,
      ARTICLE_ABOUT_CHALLENGES,
      THIN_PAGE_WITH_CLOUDFLARE_SCRIPT,
      THIN_PAGE_WITH_VERSIONED_CLOUDFLARE_SCRIPT,
      LONG_PAGE_WITH_VENDOR_SENSOR,
      NORMAL_ARTICLE_PAGE,
    ];
    for (const page of pages) expect(isProxyErrorPage(page)).toBe(false);
  });
});

// The differences a serialization taken after the page's scripts ran can add
// to the same page: a doctype, script-set attributes on <html> and <body>, an
// empty node injected at the end of the body, and newlines between tags.
function asSnapshotSerialization(html: string): string {
  const withDoctype = /^<!doctype/i.test(html) ? html : `<!DOCTYPE html>${html}`;
  const withAttributes = withDoctype
    .replace(/<html\b/i, '<html class="js"')
    .replace(/<body\b/i, '<body data-loaded="true"');
  const injected = /<\/body>/i.test(withAttributes)
    ? withAttributes.replace(/<\/body>/i, '<div id="injected-root"></div></body>')
    : `${withAttributes}<div id="injected-root"></div>`;
  return injected.replace(/></g, '>\n<');
}

const SHORT_LEGITIMATE_PAGE =
  '<html><head><title>Note</title></head><body>' +
  '<h1>XCOM 2</h1><p>A short post, but a real one.</p>' +
  '</body></html>';

const bareNetworkError = (message: string): string => `<html><body><pre>${message}</pre></body></html>`;

describe('detector verdicts on snapshot HTML', () => {
  const rows: Array<[string, string, { proxy: boolean; challenge: boolean }]> = [
    ['dead-host stub', DEAD_HOST_STUB, { proxy: true, challenge: false }],
    ['dead-host stub without its trailing node', DEAD_HOST_STUB_NO_TRAILING_NODE, { proxy: true, challenge: false }],
    ['connection refused error', bareNetworkError('net::ERR_CONNECTION_REFUSED'), { proxy: true, challenge: false }],
    ['connection reset error', bareNetworkError('connection reset by peer'), { proxy: true, challenge: false }],
    ['i/o timeout error', bareNetworkError('dial tcp 10.0.0.1:443: i/o timeout'), { proxy: true, challenge: false }],
    ['connection closed error', bareNetworkError('read tcp: connection closed'), { proxy: true, challenge: false }],
    ['Cloudflare challenge', CLOUDFLARE_CHALLENGE_PAGE, { proxy: false, challenge: true }],
    ['DataDome challenge', DATADOME_CHALLENGE_PAGE, { proxy: false, challenge: true }],
    ['PerimeterX challenge', PERIMETERX_CHALLENGE_PAGE, { proxy: false, challenge: true }],
    ['thin page with the Cloudflare script', THIN_PAGE_WITH_CLOUDFLARE_SCRIPT, { proxy: false, challenge: false }],
    ['thin page with the versioned Cloudflare script', THIN_PAGE_WITH_VERSIONED_CLOUDFLARE_SCRIPT, { proxy: false, challenge: false }],
    ['long page with a vendor sensor', LONG_PAGE_WITH_VENDOR_SENSOR, { proxy: false, challenge: false }],
    ['article about challenges', ARTICLE_ABOUT_CHALLENGES, { proxy: false, challenge: false }],
    ['normal article', NORMAL_ARTICLE_PAGE, { proxy: false, challenge: false }],
    ['short legitimate page', SHORT_LEGITIMATE_PAGE, { proxy: false, challenge: false }],
  ];

  it.each(rows)('%s gets the same verdict as /content HTML and as snapshot HTML', (_name, html, expected) => {
    const snapshot = asSnapshotSerialization(html);
    expect(snapshot).not.toBe(html);
    const fromContent = { proxy: isProxyErrorPage(html), challenge: isChallengePage(html) };
    const fromSnapshot = { proxy: isProxyErrorPage(snapshot), challenge: isChallengePage(snapshot) };
    expect(fromContent).toEqual(expected);
    expect(fromSnapshot).toEqual(fromContent);
  });
});
