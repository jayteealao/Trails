import { describe, it, expect } from 'vitest';
import { isProxyErrorPage } from './render-content.js';

// Byte-exact copy of the 275-byte stub archived by the 2026-09-04 canary:
// Chrome's plain-text rendering of the proxy's DNS failure, served as HTTP 200.
// The trailing empty, hidden <div> is part of the real page and must not
// defeat the "nothing but a <pre>" structural test — an earlier fixture
// dropped it, which hid the fact that the real page was still being archived.
const DEAD_HOST_STUB =
  '<html><head><meta name="color-scheme" content="light dark"></head>' +
  '<body><pre style="word-wrap: break-word; white-space: pre-wrap;">' +
  'dial tcp: lookup www.explorminate.net on 1.1.1.1:53: no such host\n' +
  '</pre><div id="header-bqq3lsboese" style="display: none;"></div>' +
  '</body></html>';

// The same page without the trailing empty node, kept as its own case so a
// future change to the empty-element strip cannot silently regress either shape.
const DEAD_HOST_STUB_NO_TRAILING_NODE =
  '<html><head><meta name="color-scheme" content="light dark"></head>' +
  '<body><pre style="word-wrap: break-word; white-space: pre-wrap;">' +
  'dial tcp: lookup www.explorminate.net on 1.1.1.1:53: no such host' +
  '</pre></body></html>';

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
