import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROXY_ERROR_PAGE_REASON } from '@warg/shared';
import worker from './index.js';

const INTERNAL_API_KEY = 'test-internal-key';
const TARGET_URL = 'https://example.com/article';
const PAGE_HTML = '<html><head><title>Article</title></head><body><p>Hello world</p></body></html>';
const PAGE_MARKDOWN = '# Article\n\nHello world\n';
// The 8-byte PNG signature, so a decoded screenshot is recognisable.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_BASE64 = btoa(String.fromCharCode(...PNG_BYTES));
const PDF_TEXT = '%PDF-1.7 fake';

/** One queued answer of the fake binding: a Response it resolves with, or an Error it throws. */
type BrowserAnswer = Response | Error;

/**
 * A fake browser binding. Each quickAction call takes the next queued answer;
 * a call with no answer left fails the test. The renderer must never reach the
 * REST API, so `fetch` throws.
 */
function fakeBrowser(answers: BrowserAnswer[]) {
  const queue = [...answers];
  return {
    quickAction: vi.fn(async (_action: string, _options: unknown) => {
      const next = queue.shift();
      if (!next) throw new Error('fake browser: no answer queued');
      if (next instanceof Error) throw next;
      return next;
    }),
    fetch: vi.fn(async () => {
      throw new Error('fake browser: fetch must not be called');
    })
  };
}

/** An in-memory bucket that records every put. */
function memoryBucket() {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    get: vi.fn(async (_key: string) => null),
    put: vi.fn(async (key: string, data: ArrayBuffer) => {
      objects.set(key, new Uint8Array(data));
      return null;
    })
  };
}

function snapshotAnswer(result: { content?: string; screenshot?: string; markdown?: string }): Response {
  return Response.json({ success: true, result, meta: { status: 200 } });
}

function contentAnswer(html: string): Response {
  return Response.json({ success: true, result: html, meta: { status: 200 } });
}

function pdfAnswer(): Response {
  return new Response(new TextEncoder().encode(PDF_TEXT), {
    headers: { 'Content-Type': 'application/pdf' }
  });
}

function errorAnswer(status: number, headers: Record<string, string> = {}): Response {
  return Response.json(
    { success: false, errors: [{ message: `browser error ${status}` }] },
    { status, headers }
  );
}

interface RenderBody {
  request_id?: string;
  url?: string;
  browser_quota_kind?: string;
  include_screenshot?: boolean;
  include_pdf?: boolean;
  include_markdown?: boolean;
}

/** Every field of a renderer answer that a test reads, success and error alike. */
interface RenderAnswer {
  error?: string;
  reason?: string;
  detail?: string;
  url?: string;
  status?: number;
  details?: string;
  retry_after_ms?: number;
  message?: string;
  artifacts?: Array<{ kind: string; r2Key: string; bytes: number; contentType: string }>;
  meta?: { skipped: string[] };
}

const ALL_ON: RenderBody = {
  request_id: 'req-render',
  url: TARGET_URL,
  browser_quota_kind: 'rest_request',
  include_screenshot: true,
  include_pdf: true,
  include_markdown: true
};

function makeEnv(answers: BrowserAnswer[]) {
  const browser = fakeBrowser(answers);
  const bucket = memoryBucket();
  const env = { INTERNAL_API_KEY, BROWSER: browser, ARCHIVE_BUCKET: bucket } as unknown as Env;
  return { env, browser, bucket };
}

async function render(
  body: RenderBody | string,
  env: Env,
  init: { method?: string; path?: string; key?: string | null } = {}
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = init.key === undefined ? INTERNAL_API_KEY : init.key;
  if (key !== null) headers['X-Internal-API-Key'] = key;
  const method = init.method ?? 'POST';
  const request = new Request(`https://renderer.internal${init.path ?? '/render'}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
  });
  const response = await worker.fetch(request, env, {} as ExecutionContext);
  // Test boundary: the answer is read as the union of the success and error bodies the renderer writes.
  const json = (await response.json()) as RenderAnswer;
  return { response, json };
}

// The renderer loads pages through the binding only: any network fetch fails the test.
const networkFetch = vi.fn(async () => {
  throw new Error('network fetch must not be called');
});

beforeEach(() => {
  networkFetch.mockClear();
  vi.stubGlobal('fetch', networkFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const GOTO = { waitUntil: 'load', timeout: 30000 };

function storedKinds(bucket: ReturnType<typeof memoryBucket>): string[] {
  return [...bucket.objects.keys()].map((key) => key.split('/').pop() ?? key);
}

describe('one page load per render', () => {
  it('loads the page once for html, screenshot and markdown, once for the pdf, and stores four artifacts', async () => {
    const { env, browser, bucket } = makeEnv([
      snapshotAnswer({ content: PAGE_HTML, screenshot: PNG_BASE64, markdown: PAGE_MARKDOWN }),
      pdfAnswer()
    ]);

    const { response, json } = await render(ALL_ON, env);

    expect(response.status).toBe(200);
    expect(browser.quickAction.mock.calls).toEqual([
      ['snapshot', { url: TARGET_URL, formats: ['content', 'screenshot', 'markdown'], gotoOptions: GOTO }],
      ['pdf', { url: TARGET_URL, gotoOptions: GOTO }]
    ]);
    expect(json.artifacts?.map((a) => a.kind)).toEqual(['rendered.html', 'screenshot.png', 'page.pdf', 'rendered.md']);
    expect(json.meta?.skipped).toEqual([]);
    expect(bucket.put).toHaveBeenCalledTimes(4);
    expect(bucket.objects.get('archives/req-render/raw/screenshot.png')).toEqual(PNG_BYTES);
    expect(new TextDecoder().decode(bucket.objects.get('archives/req-render/raw/rendered.html'))).toBe(PAGE_HTML);
    expect(new TextDecoder().decode(bucket.objects.get('archives/req-render/raw/rendered.md'))).toBe(PAGE_MARKDOWN);
    expect(new TextDecoder().decode(bucket.objects.get('archives/req-render/raw/page.pdf'))).toBe(PDF_TEXT);
    expect(browser.fetch).not.toHaveBeenCalled();
    expect(networkFetch).not.toHaveBeenCalled();
  });

  it('makes one snapshot load when the pdf is off', async () => {
    const { env, browser, bucket } = makeEnv([
      snapshotAnswer({ content: PAGE_HTML, screenshot: PNG_BASE64, markdown: PAGE_MARKDOWN })
    ]);

    const { response, json } = await render({ ...ALL_ON, include_pdf: false }, env);

    expect(response.status).toBe(200);
    expect(browser.quickAction).toHaveBeenCalledTimes(1);
    expect(browser.quickAction.mock.calls[0]?.[0]).toBe('snapshot');
    expect(json.artifacts?.map((a) => a.kind)).toEqual(['rendered.html', 'screenshot.png', 'rendered.md']);
    expect(json.meta?.skipped).toEqual(['pdf: not requested']);
    expect(storedKinds(bucket)).toEqual(['rendered.html', 'screenshot.png', 'rendered.md']);
    expect(networkFetch).not.toHaveBeenCalled();
  });

  it('makes one content load when only the html is asked for', async () => {
    const { env, browser } = makeEnv([contentAnswer(PAGE_HTML)]);

    const { response, json } = await render(
      { ...ALL_ON, include_screenshot: false, include_pdf: false, include_markdown: false },
      env
    );

    expect(response.status).toBe(200);
    expect(browser.quickAction.mock.calls).toEqual([['content', { url: TARGET_URL, gotoOptions: GOTO }]]);
    expect(json.artifacts?.map((a) => a.kind)).toEqual(['rendered.html']);
    expect(json.meta?.skipped).toEqual(['screenshot: not requested', 'pdf: not requested', 'markdown: not requested']);
    expect(networkFetch).not.toHaveBeenCalled();
  });
});

describe('a failed optional output keeps the html', () => {
  it('stores the html and skips the screenshot when the snapshot has no screenshot', async () => {
    const { env, bucket } = makeEnv([snapshotAnswer({ content: PAGE_HTML, markdown: PAGE_MARKDOWN }), pdfAnswer()]);

    const { response, json } = await render(ALL_ON, env);

    expect(response.status).toBe(200);
    expect(json.artifacts?.map((a) => a.kind)).toEqual(['rendered.html', 'page.pdf', 'rendered.md']);
    expect(json.meta?.skipped).toEqual(['screenshot: snapshot returned no screenshot']);
    expect(storedKinds(bucket)).toContain('rendered.html');
  });

  it('stores the html and skips the screenshot when the screenshot is not valid base64', async () => {
    const { env, bucket } = makeEnv([
      snapshotAnswer({ content: PAGE_HTML, screenshot: 'not base64!', markdown: PAGE_MARKDOWN }),
      pdfAnswer()
    ]);

    const { response, json } = await render(ALL_ON, env);

    expect(response.status).toBe(200);
    expect(json.artifacts?.map((a) => a.kind)).toEqual(['rendered.html', 'page.pdf', 'rendered.md']);
    expect(json.meta?.skipped).toEqual(['screenshot: snapshot screenshot is not valid base64']);
    expect(storedKinds(bucket)).not.toContain('screenshot.png');
  });

  it('loads the html alone once when the snapshot answers 500', async () => {
    const { env, browser, bucket } = makeEnv([errorAnswer(500), contentAnswer(PAGE_HTML), pdfAnswer()]);

    const { response, json } = await render(ALL_ON, env);

    expect(response.status).toBe(200);
    expect(browser.quickAction.mock.calls.map(([action]) => action)).toEqual(['snapshot', 'content', 'pdf']);
    expect(json.artifacts?.map((a) => a.kind)).toEqual(['rendered.html', 'page.pdf']);
    expect(json.meta?.skipped).toEqual(['screenshot: snapshot failed with 500', 'markdown: snapshot failed with 500']);
    expect(storedKinds(bucket)).toEqual(['rendered.html', 'page.pdf']);
  });

  it('loads the html alone once when the snapshot call throws', async () => {
    const { env, browser, bucket } = makeEnv([new Error('browser crashed'), contentAnswer(PAGE_HTML), pdfAnswer()]);

    const { response, json } = await render(ALL_ON, env);

    expect(response.status).toBe(200);
    expect(browser.quickAction.mock.calls.map(([action]) => action)).toEqual(['snapshot', 'content', 'pdf']);
    expect(json.meta?.skipped).toEqual([
      'screenshot: snapshot failed with browser crashed',
      'markdown: snapshot failed with browser crashed'
    ]);
    expect(storedKinds(bucket)).toEqual(['rendered.html', 'page.pdf']);
  });

  it('keeps html, screenshot and markdown when the pdf answers 500', async () => {
    const { env, bucket } = makeEnv([
      snapshotAnswer({ content: PAGE_HTML, screenshot: PNG_BASE64, markdown: PAGE_MARKDOWN }),
      errorAnswer(500)
    ]);

    const { response, json } = await render(ALL_ON, env);

    expect(response.status).toBe(200);
    expect(json.artifacts?.map((a) => a.kind)).toEqual(['rendered.html', 'screenshot.png', 'rendered.md']);
    expect(json.meta?.skipped).toEqual(['pdf: API returned 500']);
    expect(storedKinds(bucket)).toEqual(['rendered.html', 'screenshot.png', 'rendered.md']);
  });

  it('keeps html, screenshot and markdown when the pdf call throws', async () => {
    const { env, bucket } = makeEnv([
      snapshotAnswer({ content: PAGE_HTML, screenshot: PNG_BASE64, markdown: PAGE_MARKDOWN }),
      new Error('pdf crashed')
    ]);

    const { response, json } = await render(ALL_ON, env);

    expect(response.status).toBe(200);
    expect(json.artifacts?.map((a) => a.kind)).toEqual(['rendered.html', 'screenshot.png', 'rendered.md']);
    expect(json.meta?.skipped).toEqual(['pdf: pdf crashed']);
    expect(storedKinds(bucket)).toEqual(['rendered.html', 'screenshot.png', 'rendered.md']);
  });
});
