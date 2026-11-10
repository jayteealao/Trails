import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import puppeteer from '@cloudflare/puppeteer';
import { getR2Key, PROXY_ERROR_PAGE_MAX_LENGTH, PROXY_ERROR_PAGE_REASON } from '@warg/shared';
import worker from './index.js';

vi.mock('@cloudflare/puppeteer', () => ({ default: { launch: vi.fn() } }));

const KEY = 'test-internal-key';
const TARGET_URL = 'https://example.com/a';
// A SingleFile capture of a Cloudflare challenge: SingleFile drops scripts, the challenge markup stays.
const CAPTURED_CHALLENGE_PAGE =
  '<html><head><title>Just a moment...</title></head><body>' +
  '<h1 id="challenge-title">example.com</h1>' +
  '<p id="challenge-body-1">Verifying you are human. This may take a few seconds.</p>' +
  '<div id="challenge-error-text"></div></body></html>';

/** A puppeteer page whose navigation answers `status`, or `null` when `status` is undefined. */
function fakePage(status: number | undefined, captured = 'x'.repeat(200)) {
  return {
    setDefaultTimeout: vi.fn(),
    on: vi.fn(),
    evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(status === undefined ? null : { status: () => status }),
    evaluate: vi
      .fn()
      .mockResolvedValueOnce(undefined) // cleanup script
      .mockResolvedValueOnce(undefined) // scroll script
      .mockResolvedValueOnce(undefined) // SingleFile script
      .mockResolvedValueOnce(true) // availability check
      .mockResolvedValueOnce({ content: captured }), // capture
  };
}

async function runCapture(status: number | undefined, captured?: string) {
  const page = fakePage(status, captured);
  const browser = { newPage: async () => page, close: vi.fn().mockResolvedValue(undefined) };
  vi.mocked(puppeteer.launch).mockResolvedValue(
    // The handler only calls newPage() and close() on the browser.
    browser as unknown as Awaited<ReturnType<typeof puppeteer.launch>>,
  );
  const bucket = { put: vi.fn().mockResolvedValue(undefined), get: vi.fn().mockResolvedValue(null) };
  // The handler uses put() and get() alone on the bucket, and never touches the browser binding itself.
  const env = { INTERNAL_API_KEY: KEY, ARCHIVE_BUCKET: bucket, MYBROWSER: {} } as unknown as Env;
  const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;

  const response = await worker.fetch(
    new Request('https://singlefile/singlefile', {
      method: 'POST',
      headers: { 'X-Internal-API-Key': KEY },
      body: JSON.stringify({ request_id: 'req-1', url: TARGET_URL }),
    }),
    env,
    ctx,
  );
  return { response, page, bucket, browser };
}

describe('singlefile navigation status', () => {
  beforeEach(() => {
    vi.mocked(puppeteer.launch).mockReset();
  });

  it.each([403, 401])('fails the capture and stores nothing when the target answers %i', async (status) => {
    const { response, page, bucket, browser } = await runCapture(status);

    expect(response.status).toBe(403);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ reason: 'access_blocked', navigationStatus: status, url: TARGET_URL });
    expect(bucket.put).not.toHaveBeenCalled();
    expect(page.evaluate).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it.each([
    ['200', 200],
    ['a same-document (null)', undefined],
  ])('captures and stores the page when the navigation answers %s', async (_label, status) => {
    const { response, bucket } = await runCapture(status);

    expect(response.status).toBe(200);
    expect(bucket.put).toHaveBeenCalledOnce();
    expect(bucket.put.mock.calls[0]?.[0]).toBe(getR2Key('req-1', 'singlefile.html'));
  });
});

describe('singlefile challenge page', () => {
  beforeEach(() => {
    vi.mocked(puppeteer.launch).mockReset();
  });

  it('refuses to store a challenge page that the target served with HTTP 200', async () => {
    const { response, bucket } = await runCapture(200, CAPTURED_CHALLENGE_PAGE);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ reason: 'access_blocked', url: TARGET_URL });
    expect(bucket.put).not.toHaveBeenCalled();
  });
});

describe('singlefile capture checks', () => {
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

  beforeEach(() => {
    // The shared puppeteer mock launches a browser whose page captures `capturedContent`.
    vi.mocked(puppeteer.launch).mockReset();
    vi.mocked(puppeteer.launch).mockImplementation(
      async () =>
        // The handler only calls newPage() and close() on the browser.
        ({
          newPage: vi.fn(async () => makeFakePage()),
          close: vi.fn(async () => undefined),
        }) as unknown as Awaited<ReturnType<typeof puppeteer.launch>>,
    );
  });

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
    detail: 'dial tcp: lookup www.explorminate.net on 1.1.1.1:53: no such host',
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
});
