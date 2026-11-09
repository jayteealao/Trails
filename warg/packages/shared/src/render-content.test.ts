import { describe, it, expect } from 'vitest';
import { isDeadHostErrorText, isProxyErrorPage, PROXY_ERROR_PAGE_MAX_LENGTH, proxyErrorPageText } from './render-content.js';

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

// Shell of the observed stub, so each case below differs from the real page
// only by the markup it adds beside the error <pre>.
const STUB_PRE =
  '<pre style="word-wrap: break-word; white-space: pre-wrap;">' +
  'dial tcp: lookup www.explorminate.net on 1.1.1.1:53: no such host\n' +
  '</pre>';

function stubPage(before: string, after: string): string {
  return (
    '<html><head><meta name="color-scheme" content="light dark"></head>' +
    `<body>${before}${STUB_PRE}${after}</body></html>`
  );
}

describe('isProxyErrorPage — void tags and empty nodes beside the pre', () => {
  it('rejects the stub with a line break after the pre', () => {
    expect(isProxyErrorPage(stubPage('', '<br>'))).toBe(true);
  });

  it('rejects the stub with a meta tag before the pre inside the body', () => {
    expect(isProxyErrorPage(stubPage('<meta charset="utf-8">', ''))).toBe(true);
  });

  it('rejects the stub with a stylesheet link before the pre', () => {
    expect(isProxyErrorPage(stubPage('<link rel="stylesheet" href="x.css">', ''))).toBe(true);
  });

  it('rejects the stub with an image after the pre', () => {
    expect(isProxyErrorPage(stubPage('', '<img src="pixel.gif" alt="">'))).toBe(true);
  });

  it('rejects the stub with self-closing void tags', () => {
    expect(isProxyErrorPage(stubPage('<br/>', '<img src="p.gif" />'))).toBe(true);
  });

  it('rejects the stub with an element that holds only a line break', () => {
    expect(isProxyErrorPage(stubPage('', '<div><br></div>'))).toBe(true);
  });

  it('rejects the real stub shape: hidden empty div and a line break beside the pre', () => {
    const page = stubPage('', '<div id="header-bqq3lsboese" style="display: none;"></div><br>');
    expect(page.length).toBeGreaterThanOrEqual(275);
    expect(page.length).toBeLessThanOrEqual(400);
    expect(isProxyErrorPage(page)).toBe(true);
  });

  it('accepts a line break beside a pre that holds ordinary code', () => {
    const page =
      '<html><body><pre>function add(a, b) { return a + b; }</pre><br></body></html>';
    expect(isProxyErrorPage(page)).toBe(false);
  });

  it('accepts an image beside prose and an error pre', () => {
    const page =
      '<html><body><img src="diagram.png" alt="">' +
      '<p>The proxy answered with this error:</p>' +
      '<pre>dial tcp: lookup example.com on 1.1.1.1:53: no such host</pre>' +
      '</body></html>';
    expect(isProxyErrorPage(page)).toBe(false);
  });

  it('accepts a line break beside a pre whose error text is too long to be a message', () => {
    const text = `dial tcp: no such host ${'x'.repeat(600)}`;
    const page = `<html><body><pre>${text}</pre><br></body></html>`;
    expect(isProxyErrorPage(page)).toBe(false);
  });
});

// The observed stub, padded with whitespace inside <body> to an exact length.
function padStubTo(length: number): string {
  const closing = '</body></html>';
  const head = DEAD_HOST_STUB.slice(0, -closing.length);
  return head + ' '.repeat(length - DEAD_HOST_STUB.length) + closing;
}

describe('isProxyErrorPage — bounded input', () => {
  it('accepts a 5 MB document without treating it as a stub', () => {
    const page = padStubTo(DEAD_HOST_STUB.length + 5 * 1024 * 1024);
    expect(isProxyErrorPage(page)).toBe(false);
  });

  it('still reads a stub of exactly the limit and ignores one character more', () => {
    const atLimit = padStubTo(PROXY_ERROR_PAGE_MAX_LENGTH);
    const pastLimit = padStubTo(PROXY_ERROR_PAGE_MAX_LENGTH + 1);
    expect(atLimit.length).toBe(PROXY_ERROR_PAGE_MAX_LENGTH);
    expect(pastLimit.length).toBe(PROXY_ERROR_PAGE_MAX_LENGTH + 1);
    expect(isProxyErrorPage(atLimit)).toBe(true);
    expect(isProxyErrorPage(pastLimit)).toBe(false);
  });

  it('returns at once for a long run of unclosed tags instead of scanning it', () => {
    const page = '<a'.repeat(Math.ceil((PROXY_ERROR_PAGE_MAX_LENGTH + 1) / 2));
    const started = performance.now();
    const verdict = isProxyErrorPage(page);
    const elapsed = performance.now() - started;
    expect(verdict).toBe(false);
    expect(elapsed).toBeLessThan(50);
  });

  it('keeps the limit large enough for a stub with a heavy head', () => {
    expect(Number.isInteger(PROXY_ERROR_PAGE_MAX_LENGTH)).toBe(true);
    expect(PROXY_ERROR_PAGE_MAX_LENGTH).toBeGreaterThanOrEqual(16 * 1024);
  });
});

describe('proxyErrorPageText', () => {
  it('returns the error text of a stub and nothing for a real page', () => {
    expect(proxyErrorPageText(DEAD_HOST_STUB)).toBe('dial tcp: lookup www.explorminate.net on 1.1.1.1:53: no such host');
    expect(proxyErrorPageText('<html><body><p>An article</p></body></html>')).toBeUndefined();
    expect(proxyErrorPageText('')).toBe('');
  });
});

describe('isDeadHostErrorText', () => {
  it.each([
    'dial tcp: lookup www.explorminate.net on 1.1.1.1:53: no such host',
    'dial tcp 1.2.3.4:443: connect: connection refused',
    'dial tcp 1.2.3.4:443: connect: no route to host',
    'net::ERR_NAME_NOT_RESOLVED',
  ])('reads "%s" as a dead host', (text) => {
    expect(isDeadHostErrorText(text)).toBe(true);
  });

  it.each([
    'dial tcp 1.2.3.4:443: i/o timeout',
    'dial tcp 1.2.3.4:443: some new failure',
    'read tcp 1.2.3.4:443: connection reset by peer',
    'context deadline exceeded (no such host lookup pending)',
  ])('keeps "%s" retryable', (text) => {
    expect(isDeadHostErrorText(text)).toBe(false);
  });
});
