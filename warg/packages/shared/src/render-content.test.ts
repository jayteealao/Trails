import { describe, it, expect } from 'vitest';
import { isProxyErrorPage } from './render-content.js';

// Verbatim shape of the archived stub from the 2026-09-04 canary: Chrome's
// plain-text rendering of the proxy's DNS failure, served as HTTP 200.
const DEAD_HOST_STUB =
  '<html><head><meta name="color-scheme" content="light dark"></head>' +
  '<body><pre style="word-wrap: break-word; white-space: pre-wrap;">' +
  'dial tcp: lookup www.explorminate.net on 1.1.1.1:53: no such host' +
  '</pre></body></html>';

describe('isProxyErrorPage', () => {
  it('rejects the observed dead-host proxy stub', () => {
    expect(isProxyErrorPage(DEAD_HOST_STUB)).toBe(true);
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
