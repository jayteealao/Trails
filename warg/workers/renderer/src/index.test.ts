import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ARTICLE_ABOUT_CHALLENGES,
  CLOUDFLARE_CHALLENGE_PAGE,
  DATADOME_CHALLENGE_PAGE,
  DEAD_HOST_STUB,
  DEAD_HOST_STUB_NO_TRAILING_NODE,
  LONG_PAGE_WITH_VENDOR_SENSOR,
  NORMAL_ARTICLE_PAGE,
  PERIMETERX_CHALLENGE_PAGE,
  THIN_PAGE_WITH_CLOUDFLARE_SCRIPT,
} from '@warg/shared/fixtures';
import worker from './index.js';

const KEY = 'test-internal-key';
const TARGET_URL = 'https://example.com/a';
const GOTO_OPTIONS = { waitUntil: 'load', timeout: 30000 };
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_BASE64 = btoa(String.fromCharCode(...PNG_SIGNATURE));
const PDF_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d];
const META = { status: 200, title: 'A page' };

/** The parts of a renderer answer these tests read. */
interface RenderBody {
  artifacts?: Array<{ kind: string }>;
  meta?: { skipped: string[] };
  error?: string;
  reason?: string;
  status?: number;
  details?: string;
  retry_after_ms?: number;
}

function snapshotAnswer(result: { content?: string; screenshot?: string; markdown?: string }): Response {
  return Response.json({ success: true, result, meta: META });
}

function contentAnswer(html: string): Response {
  return Response.json({ success: true, result: html, meta: META });
}

function pdfAnswer(): Response {
  return new Response(new Uint8Array(PDF_BYTES), { headers: { 'Content-Type': 'application/pdf' } });
}

function errorAnswer(status: number, headers: Record<string, string> = {}): Response {
  return Response.json(
    { success: false, errors: [{ message: 'Browser Run failed', code: 5006 }] },
    { status, headers },
  );
}

/** A browser binding that answers each quickAction() with the next queued answer and records the call. */
function fakeBrowser(answers: Response[]) {
  return {
    quickAction: vi.fn(async (_action: string, _options: unknown): Promise<Response> => {
      const next = answers.shift();
      if (!next) throw new Error('unexpected quickAction() call');
      return next;
    }),
    fetch: vi.fn(async (): Promise<Response> => {
      throw new Error('the renderer must not call the binding fetch()');
    }),
  };
}

async function render(answers: Response[], flags: Record<string, unknown> = {}, headers: Record<string, string> = { 'X-Internal-API-Key': KEY }) {
  const browser = fakeBrowser(answers);
  const bucket = { put: vi.fn().mockResolvedValue(undefined), get: vi.fn().mockResolvedValue(null) };
  // The handler reads the key, calls put()/get() on the bucket and quickAction() on the binding, nothing else.
  const env = { INTERNAL_API_KEY: KEY, ARCHIVE_BUCKET: bucket, BROWSER: browser } as unknown as Env;
  const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
  const response = await worker.fetch(
    new Request('https://renderer/render', {
      method: 'POST',
      headers,
      body: JSON.stringify({ request_id: 'req-1', url: TARGET_URL, browser_quota_kind: 'bindings_launch', ...flags }),
    }),
    env,
    ctx,
  );
  // The renderer answers JSON on every path these tests drive.
  const body = (await response.json()) as RenderBody;
  return { response, body, browser, bucket };
}

function kinds(body: RenderBody): string[] {
  return (body.artifacts ?? []).map((artifact) => artifact.kind);
}

function storedBytes(bucket: { put: ReturnType<typeof vi.fn> }, name: string): number[] {
  const call = bucket.put.mock.calls.find(([key]) => String(key).endsWith(`/${name}`));
  if (!call) throw new Error(`${name} was not stored`);
  return Array.from(new Uint8Array(call[1] as ArrayBuffer));
}

let restFetch: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  restFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('the renderer must not call a REST API'));
});

afterEach(() => {
  restFetch.mockRestore();
});

describe('one snapshot load', () => {
  it.each([
    ['plain base64', PNG_BASE64],
    ['a data URI', `data:image/png;base64,${PNG_BASE64}`],
  ])('takes HTML, screenshot (%s) and Markdown from one snapshot call and no REST fetch', async (_label, screenshot) => {
    const { response, body, browser, bucket } = await render(
      [snapshotAnswer({ content: NORMAL_ARTICLE_PAGE, screenshot, markdown: '# Notes on sourdough' })],
      { include_screenshot: true, include_markdown: true },
    );

    expect(response.status).toBe(200);
    expect(browser.quickAction).toHaveBeenCalledTimes(1);
    expect(browser.quickAction).toHaveBeenCalledWith('snapshot', {
      url: TARGET_URL,
      formats: ['content', 'screenshot', 'markdown'],
      gotoOptions: GOTO_OPTIONS,
    });
    expect(browser.fetch).not.toHaveBeenCalled();
    expect(restFetch).not.toHaveBeenCalled();
    expect(kinds(body)).toEqual(['rendered.html', 'screenshot.png', 'rendered.md']);
    expect(storedBytes(bucket, 'screenshot.png')).toEqual(PNG_SIGNATURE);
    expect(body.meta?.skipped).toEqual(['pdf: not requested']);
  });

  it('loads the PDF separately, after the snapshot, when include_pdf is set', async () => {
    const { response, body, browser, bucket } = await render(
      [snapshotAnswer({ content: NORMAL_ARTICLE_PAGE, screenshot: PNG_BASE64, markdown: '# md' }), pdfAnswer()],
      { include_screenshot: true, include_markdown: true, include_pdf: true },
    );

    expect(response.status).toBe(200);
    expect(browser.quickAction).toHaveBeenCalledTimes(2);
    expect(browser.quickAction.mock.calls.map(([action]) => action)).toEqual(['snapshot', 'pdf']);
    expect(browser.quickAction).toHaveBeenLastCalledWith('pdf', { url: TARGET_URL, gotoOptions: GOTO_OPTIONS });
    expect(kinds(body)).toContain('page.pdf');
    expect(storedBytes(bucket, 'page.pdf')).toEqual(PDF_BYTES);
    expect(restFetch).not.toHaveBeenCalled();
  });

  it('uses one content call for an HTML-only render', async () => {
    const { response, body, browser } = await render([contentAnswer(NORMAL_ARTICLE_PAGE)]);

    expect(response.status).toBe(200);
    expect(browser.quickAction).toHaveBeenCalledTimes(1);
    expect(browser.quickAction).toHaveBeenCalledWith('content', { url: TARGET_URL, gotoOptions: GOTO_OPTIONS });
    expect(kinds(body)).toEqual(['rendered.html']);
    expect(body.meta?.skipped).toEqual(['screenshot: not requested', 'pdf: not requested', 'markdown: not requested']);
  });
});

describe('page detectors on snapshot HTML', () => {
  it.each([
    ['the dead-host stub', DEAD_HOST_STUB],
    ['the dead-host stub without its trailing node', DEAD_HOST_STUB_NO_TRAILING_NODE],
  ])('answers 502 proxy_error_page for %s and stores nothing', async (_label, html) => {
    const { response, body, bucket } = await render([snapshotAnswer({ content: html, screenshot: PNG_BASE64 })], {
      include_screenshot: true,
    });

    expect(response.status).toBe(502);
    expect(body.reason).toBe('proxy_error_page');
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it.each([
    ['the Cloudflare challenge', CLOUDFLARE_CHALLENGE_PAGE],
    ['the DataDome challenge', DATADOME_CHALLENGE_PAGE],
    ['the PerimeterX challenge', PERIMETERX_CHALLENGE_PAGE],
  ])('answers 403 access_blocked for %s and stores nothing', async (_label, html) => {
    const { response, body, bucket } = await render([snapshotAnswer({ content: html, screenshot: PNG_BASE64 })], {
      include_screenshot: true,
    });

    expect(response.status).toBe(403);
    expect(body.reason).toBe('access_blocked');
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it.each([
    ['a normal article', NORMAL_ARTICLE_PAGE],
    ['an article about challenges', ARTICLE_ABOUT_CHALLENGES],
    ['a thin page with the Cloudflare script', THIN_PAGE_WITH_CLOUDFLARE_SCRIPT],
    ['a long page with a vendor sensor', LONG_PAGE_WITH_VENDOR_SENSOR],
  ])('archives %s', async (_label, html) => {
    const { response, body } = await render([snapshotAnswer({ content: html, screenshot: PNG_BASE64 })], {
      include_screenshot: true,
    });

    expect(response.status).toBe(200);
    expect(kinds(body)).toEqual(['rendered.html', 'screenshot.png']);
  });
});

describe('partial snapshot', () => {
  it('keeps the HTML and skips a missing screenshot', async () => {
    const { response, body } = await render([snapshotAnswer({ content: NORMAL_ARTICLE_PAGE, markdown: '# md' })], {
      include_screenshot: true,
      include_markdown: true,
    });

    expect(response.status).toBe(200);
    expect(kinds(body)).toEqual(['rendered.html', 'rendered.md']);
    expect(body.meta?.skipped).toContain('screenshot: snapshot returned no screenshot');
  });

  it('keeps the HTML and skips a missing Markdown', async () => {
    const { response, body } = await render([snapshotAnswer({ content: NORMAL_ARTICLE_PAGE, screenshot: PNG_BASE64 })], {
      include_screenshot: true,
      include_markdown: true,
    });

    expect(response.status).toBe(200);
    expect(kinds(body)).toEqual(['rendered.html', 'screenshot.png']);
    expect(body.meta?.skipped).toContain('markdown: snapshot returned no markdown');
  });

  it('keeps the HTML and lists both misses', async () => {
    const { response, body } = await render([snapshotAnswer({ content: NORMAL_ARTICLE_PAGE, screenshot: '', markdown: '' })], {
      include_screenshot: true,
      include_markdown: true,
    });

    expect(response.status).toBe(200);
    expect(kinds(body)).toEqual(['rendered.html']);
    expect(body.meta?.skipped).toEqual(
      expect.arrayContaining(['screenshot: snapshot returned no screenshot', 'markdown: snapshot returned no markdown']),
    );
  });
});

describe('binding failures', () => {
  it('answers 429 rate_limited with the Retry-After of the snapshot, and stores nothing', async () => {
    const { response, body, bucket } = await render([errorAnswer(429, { 'Retry-After': '7' })], {
      include_screenshot: true,
    });

    expect(response.status).toBe(429);
    expect(body).toMatchObject({ error: 'rate_limited', retry_after_ms: 7000 });
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it('answers 429 rate_limited when the PDF load is rate limited', async () => {
    const { response, body } = await render(
      [snapshotAnswer({ content: NORMAL_ARTICLE_PAGE, screenshot: PNG_BASE64 }), errorAnswer(429, { 'Retry-After': '3' })],
      { include_screenshot: true, include_pdf: true },
    );

    expect(response.status).toBe(429);
    expect(body).toMatchObject({ error: 'rate_limited', retry_after_ms: 3000 });
  });

  it.each([403, 500])('answers 502 with the failure body the workflow reads when the snapshot answers %i', async (status) => {
    const { response, body, bucket } = await render([errorAnswer(status)], { include_screenshot: true });

    expect(response.status).toBe(502);
    expect(body.error).toBe('Browser Rendering /content failed');
    expect(body.status).toBe(status);
    expect(body.details).toContain('5006');
    expect(body).not.toHaveProperty('reason');
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it('skips the PDF when its load fails', async () => {
    const { response, body } = await render(
      [snapshotAnswer({ content: NORMAL_ARTICLE_PAGE, screenshot: PNG_BASE64 }), errorAnswer(500)],
      { include_screenshot: true, include_pdf: true },
    );

    expect(response.status).toBe(200);
    expect(kinds(body)).not.toContain('page.pdf');
    expect(body.meta?.skipped).toContain('pdf: API returned 500');
  });
});

describe('request guards', () => {
  it('answers 401 without the internal key', async () => {
    const { response, browser } = await render([], {}, {});
    expect(response.status).toBe(401);
    expect(browser.quickAction).not.toHaveBeenCalled();
  });

  it('answers 404 off the render route', async () => {
    const browser = fakeBrowser([]);
    // Only the key and the binding are read before the route check answers.
    const env = { INTERNAL_API_KEY: KEY, BROWSER: browser } as unknown as Env;
    const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
    const response = await worker.fetch(new Request('https://renderer/other', { method: 'POST' }), env, ctx);
    expect(response.status).toBe(404);
  });

  it('answers 400 when a required field is missing', async () => {
    const { response, browser } = await render([], { browser_quota_kind: undefined });
    expect(response.status).toBe(400);
    expect(browser.quickAction).not.toHaveBeenCalled();
  });
});
