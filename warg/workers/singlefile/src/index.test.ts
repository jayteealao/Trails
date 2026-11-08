import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROXY_ERROR_PAGE_MAX_LENGTH, PROXY_ERROR_PAGE_REASON } from '@warg/shared';

// The fake page resolves every capture with whatever the current test sets here.
let capturedContent = '';

function makeFakePage() {
  return {
    setDefaultTimeout: vi.fn(),
    on: vi.fn(),
    evaluateOnNewDocument: vi.fn(async () => undefined),
    goto: vi.fn(async () => undefined),
    // Script strings (cleanup, scroll, the SingleFile bundle) resolve to nothing;
    // the availability probe is a function with no argument; the capture is a
    // function called with the SingleFile options.
    evaluate: vi.fn(async (script: unknown, options?: unknown) => {
      if (typeof script !== 'function') return undefined;
      if (options === undefined) return true;
      return { content: capturedContent };
    }),
  };
}

vi.mock('@cloudflare/puppeteer', () => ({
  default: {
    launch: vi.fn(async () => ({
      newPage: vi.fn(async () => makeFakePage()),
      close: vi.fn(async () => undefined),
    })),
  },
}));

const { default: worker } = await import('./index.js');

const TARGET_URL = 'https://www.explorminate.net/post';
const INTERNAL_API_KEY = 'test-internal-key';

function makeBucket() {
  return {
    get: vi.fn(async () => null),
    put: vi.fn(async () => undefined),
  };
}

async function runCapture(content: string, bucket = makeBucket()) {
  capturedContent = content;
  // Only the bindings the handler reads are faked.
  const env = {
    INTERNAL_API_KEY,
    ARCHIVE_BUCKET: bucket,
    MYBROWSER: {},
  } as unknown as Env;
  const request = new Request('https://singlefile.internal/singlefile', {
    method: 'POST',
    headers: { 'X-Internal-API-Key': INTERNAL_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: 'req-sf', url: TARGET_URL }),
  });
  const response = await worker.fetch(request, env, {} as ExecutionContext);
  const body: unknown = await response.json();
  return { response, body, bucket };
}

// Byte-exact copy of the 275-byte stub archived by the 2026-09-04 canary:
// Chrome's plain-text rendering of the proxy's DNS failure, served as HTTP 200.
const DEAD_HOST_STUB =
  '<html><head><meta name="color-scheme" content="light dark"></head>' +
  '<body><pre style="word-wrap: break-word; white-space: pre-wrap;">' +
  'dial tcp: lookup www.explorminate.net on 1.1.1.1:53: no such host\n' +
  '</pre><div id="header-bqq3lsboese" style="display: none;"></div>' +
  '</body></html>';

// The same stub as SingleFile serialises it: a doctype, its "saved with"
// comment, a head with charset, inlined styles, referrer and canonical tags,
// and the hidden <div> removed.
const SINGLEFILE_STUB_CAPTURE =
  '<!DOCTYPE html> <html><!--\n Page saved with SingleFile \n url: https://www.explorminate.net/post \n' +
  ' saved date: Fri Sep 04 2026 10:12:31 GMT+0000 (Coordinated Universal Time)\n-->' +
  '<head><meta charset=utf-8><meta name=color-scheme content="light dark">' +
  '<style>pre{word-wrap:break-word;white-space:pre-wrap}</style>' +
  '<meta name=referrer content=no-referrer>' +
  '<link rel=canonical href=https://www.explorminate.net/post></head>' +
  '<body><pre style="word-wrap:break-word;white-space:pre-wrap">' +
  'dial tcp: lookup www.explorminate.net on 1.1.1.1:53: no such host\n' +
  '</pre></body></html>';

/** The stub, padded with whitespace before `</body>` to exactly `length` characters. */
function padStubTo(length: number): string {
  const padding = ' '.repeat(length - DEAD_HOST_STUB.length);
  return DEAD_HOST_STUB.replace('</body>', `${padding}</body>`);
}

const STUB_REJECTION = {
  error: 'SingleFile capture returned a proxy/network error page',
  reason: PROXY_ERROR_PAGE_REASON,
  url: TARGET_URL,
};

function makeArticle(): string {
  const paragraph =
    '<p>The archive keeps a faithful copy of the page so it can be read long after the original is gone. ' +
    'Each paragraph here stands in for the body text of a real article.</p>';
  return (
    '<html><body><article><h1>A real article</h1>' +
    paragraph.repeat(1200) +
    '</article></body></html>'
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('singlefile capture validation', () => {
  it('rejects a capture that is too short and stores nothing', async () => {
    const { response, body, bucket } = await runCapture('x'.repeat(50));

    expect(response.status).toBe(502);
    expect(body).toEqual({ error: 'SingleFile capture failed: content too short', length: 50 });
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it('stores a normal large page as before', async () => {
    const article = makeArticle();
    expect(article.length).toBeGreaterThan(200_000);

    const { response, body, bucket } = await runCapture(article);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      artifact: {
        kind: 'singlefile.html',
        r2Key: 'archives/req-sf/derived/singlefile.html',
        bytes: new TextEncoder().encode(article).byteLength,
        contentType: 'text/html',
      },
    });
    expect(bucket.put).toHaveBeenCalledTimes(1);
  });
});

describe('singlefile proxy error page rejection', () => {
  it('rejects the 275-byte proxy error stub and stores nothing', async () => {
    expect(DEAD_HOST_STUB.length).toBe(275);

    const { response, body, bucket } = await runCapture(DEAD_HOST_STUB);

    expect(response.status).toBe(502);
    expect(body).toEqual(STUB_REJECTION);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it('rejects the stub as SingleFile serialises it and stores nothing', async () => {
    expect(SINGLEFILE_STUB_CAPTURE.length).toBeLessThan(PROXY_ERROR_PAGE_MAX_LENGTH);

    const { response, body, bucket } = await runCapture(SINGLEFILE_STUB_CAPTURE);

    expect(response.status).toBe(502);
    expect(body).toEqual(STUB_REJECTION);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it('rejects a stub-shaped capture right at the detector length limit', async () => {
    const capture = padStubTo(PROXY_ERROR_PAGE_MAX_LENGTH);
    expect(capture.length).toBe(PROXY_ERROR_PAGE_MAX_LENGTH);

    const { response, body, bucket } = await runCapture(capture);

    expect(response.status).toBe(502);
    expect(body).toEqual(STUB_REJECTION);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it('stores a capture one character past the limit without scanning it', async () => {
    const capture = padStubTo(PROXY_ERROR_PAGE_MAX_LENGTH + 1);
    expect(capture.length).toBe(PROXY_ERROR_PAGE_MAX_LENGTH + 1);

    const { response, bucket } = await runCapture(capture);

    expect(response.status).toBe(200);
    expect(bucket.put).toHaveBeenCalledTimes(1);
  });
});
