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
import { storeArtifact, PROXY_ERROR_PAGE_REASON } from '@warg/shared';
import type { ArtifactKind, ArtifactMeta } from '@warg/shared';
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
  artifacts?: ArtifactMeta[];
  meta?: { skipped: string[]; reused?: string[] };
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

interface StoredObject {
  data: ArrayBuffer;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
}

/** An in-memory bucket whose put(), get() and head() read and write one Map, each recorded. */
function memoryBucket() {
  const objects = new Map<string, StoredObject>();
  return {
    objects,
    put: vi.fn(
      async (
        key: string,
        data: ArrayBuffer,
        options?: { httpMetadata?: { contentType: string }; customMetadata?: Record<string, string> },
      ) => {
        objects.set(key, { data, httpMetadata: options?.httpMetadata, customMetadata: options?.customMetadata });
        return {};
      },
    ),
    get: vi.fn(async () => null),
    head: vi.fn(async (key: string) => {
      const object = objects.get(key);
      if (!object) return null;
      return { size: object.data.byteLength, httpMetadata: object.httpMetadata, customMetadata: object.customMetadata };
    }),
  };
}

type MemoryBucket = ReturnType<typeof memoryBucket>;

const SEEDED: Partial<Record<ArtifactKind, { bytes: number[]; contentType: string }>> = {
  'rendered.html': { bytes: Array.from(new TextEncoder().encode(NORMAL_ARTICLE_PAGE)), contentType: 'text/html' },
  'screenshot.png': { bytes: PNG_SIGNATURE, contentType: 'image/png' },
  'rendered.md': { bytes: Array.from(new TextEncoder().encode('# Earlier attempt')), contentType: 'text/markdown' },
  'page.pdf': { bytes: PDF_BYTES, contentType: 'application/pdf' },
};

/** Store an artifact as an earlier attempt would have, then forget the put() so a test counts only its own. */
async function seed(bucket: MemoryBucket, kind: ArtifactKind, scope?: string): Promise<ArtifactMeta> {
  const { bytes, contentType } = SEEDED[kind] ?? { bytes: [1], contentType: 'application/octet-stream' };
  const meta = await storeArtifact(bucket, 'req-1', kind, new Uint8Array(bytes).buffer, contentType, scope);
  bucket.put.mockClear();
  return meta;
}

function putKinds(bucket: { put: ReturnType<typeof vi.fn> }): string[] {
  return bucket.put.mock.calls.map(([key]) => String(key).split('/').pop() ?? '');
}

interface TestBucket {
  put: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  head?: ReturnType<typeof vi.fn>;
}

async function render(
  answers: Response[],
  flags: Record<string, unknown> = {},
  headers: Record<string, string> = { 'X-Internal-API-Key': KEY },
  bucket: TestBucket = { put: vi.fn().mockResolvedValue(undefined), get: vi.fn().mockResolvedValue(null) },
) {
  const browser = fakeBrowser(answers);
  // The handler reads the key, calls put()/get()/head() on the bucket and quickAction() on the binding, nothing else.
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

  it('keeps the HTML and skips a screenshot that is not valid base64', async () => {
    const { response, body } = await render([snapshotAnswer({ content: NORMAL_ARTICLE_PAGE, screenshot: '***not base64***' })], {
      include_screenshot: true,
    });

    expect(response.status).toBe(200);
    expect(kinds(body)).toEqual(['rendered.html']);
    expect(body.meta?.skipped).toContain('screenshot: snapshot screenshot is not valid base64');
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

  it('answers 502 with the failure body the workflow reads when the snapshot answers 403, with no second load', async () => {
    const { response, body, bucket, browser } = await render([errorAnswer(403)], { include_screenshot: true });

    expect(response.status).toBe(502);
    expect(browser.quickAction).toHaveBeenCalledTimes(1);
    expect(body.error).toBe('Browser Rendering /content failed');
    expect(body.status).toBe(403);
    expect(body).not.toHaveProperty('reason');
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it('keeps the HTML from one content load when the snapshot fails, and skips the screenshot and Markdown', async () => {
    const { response, body, browser } = await render([errorAnswer(500), contentAnswer(NORMAL_ARTICLE_PAGE)], {
      include_screenshot: true,
      include_markdown: true,
    });

    expect(response.status).toBe(200);
    expect(browser.quickAction.mock.calls.map(([action]) => action)).toEqual(['snapshot', 'content']);
    expect(kinds(body)).toEqual(['rendered.html']);
    expect(body.meta?.skipped).toEqual(
      expect.arrayContaining(['screenshot: snapshot failed with 500', 'markdown: snapshot failed with 500']),
    );
  });

  it('answers 429 when the HTML-only load after a failed snapshot is rate limited', async () => {
    const { response, body } = await render([errorAnswer(500), errorAnswer(429, { 'Retry-After': '2' })], {
      include_screenshot: true,
    });

    expect(response.status).toBe(429);
    expect(body).toMatchObject({ error: 'rate_limited', retry_after_ms: 2000 });
  });

  it.each([403, 500])('answers 502 with the failure body the workflow reads when every load answers %i', async (status) => {
    const { response, body, bucket } = await render([errorAnswer(status), errorAnswer(status)], { include_screenshot: true });

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

describe('a retry of the same run', () => {
  const RETRY = { reuse_scope: 'run-1' };
  const AUTH = { 'X-Internal-API-Key': KEY };

  it('makes no load and writes nothing when the HTML, screenshot and Markdown are already stored', async () => {
    const bucket = memoryBucket();
    const html = await seed(bucket, 'rendered.html', 'run-1');
    const screenshot = await seed(bucket, 'screenshot.png', 'run-1');
    const markdown = await seed(bucket, 'rendered.md', 'run-1');

    const { response, body, browser } = await render(
      [],
      { include_screenshot: true, include_markdown: true, ...RETRY },
      AUTH,
      bucket,
    );

    expect(response.status).toBe(200);
    expect(browser.quickAction).not.toHaveBeenCalled();
    expect(bucket.put).not.toHaveBeenCalled();
    expect(kinds(body)).toEqual(['rendered.html', 'screenshot.png', 'rendered.md']);
    expect(body.artifacts).toEqual([html, screenshot, markdown]);
    expect(body.meta?.reused).toEqual(['rendered.html', 'screenshot.png', 'rendered.md']);
    expect(body.meta?.skipped).toEqual(['pdf: not requested']);
  });

  it('refills the missing artifacts with one snapshot and does not rewrite the stored HTML', async () => {
    const bucket = memoryBucket();
    const html = await seed(bucket, 'rendered.html', 'run-1');

    const { response, body, browser } = await render(
      [snapshotAnswer({ content: NORMAL_ARTICLE_PAGE, screenshot: PNG_BASE64, markdown: '# Refilled' })],
      { include_screenshot: true, include_markdown: true, ...RETRY },
      AUTH,
      bucket,
    );

    expect(response.status).toBe(200);
    expect(browser.quickAction).toHaveBeenCalledTimes(1);
    expect(browser.quickAction).toHaveBeenCalledWith('snapshot', {
      url: TARGET_URL,
      formats: ['content', 'screenshot', 'markdown'],
      gotoOptions: GOTO_OPTIONS,
    });
    expect(putKinds(bucket)).toEqual(['screenshot.png', 'rendered.md']);
    expect(body.artifacts?.[0]).toEqual(html);
    expect(kinds(body)).toEqual(['rendered.html', 'screenshot.png', 'rendered.md']);
    expect(body.meta?.reused).toEqual(['rendered.html']);
  });

  it('makes only the PDF load when everything but the PDF is stored', async () => {
    const bucket = memoryBucket();
    await seed(bucket, 'rendered.html', 'run-1');
    await seed(bucket, 'screenshot.png', 'run-1');
    await seed(bucket, 'rendered.md', 'run-1');

    const { response, body, browser } = await render(
      [pdfAnswer()],
      { include_screenshot: true, include_markdown: true, include_pdf: true, ...RETRY },
      AUTH,
      bucket,
    );

    expect(response.status).toBe(200);
    expect(browser.quickAction).toHaveBeenCalledTimes(1);
    expect(browser.quickAction).toHaveBeenCalledWith('pdf', { url: TARGET_URL, gotoOptions: GOTO_OPTIONS });
    expect(putKinds(bucket)).toEqual(['page.pdf']);
    expect(kinds(body)).toEqual(['rendered.html', 'screenshot.png', 'page.pdf', 'rendered.md']);
  });

  it('asks the snapshot only for the screenshot when only the screenshot is missing', async () => {
    const bucket = memoryBucket();
    await seed(bucket, 'rendered.html', 'run-1');
    await seed(bucket, 'rendered.md', 'run-1');

    const { response, body, browser } = await render(
      [snapshotAnswer({ content: NORMAL_ARTICLE_PAGE, screenshot: PNG_BASE64 })],
      { include_screenshot: true, include_markdown: true, ...RETRY },
      AUTH,
      bucket,
    );

    expect(response.status).toBe(200);
    expect(browser.quickAction).toHaveBeenCalledTimes(1);
    expect(browser.quickAction).toHaveBeenCalledWith('snapshot', {
      url: TARGET_URL,
      formats: ['content', 'screenshot'],
      gotoOptions: GOTO_OPTIONS,
    });
    expect(putKinds(bucket)).toEqual(['screenshot.png']);
    expect(kinds(body)).toEqual(['rendered.html', 'screenshot.png', 'rendered.md']);
  });

  it('makes one content call when only the HTML is missing', async () => {
    const bucket = memoryBucket();
    await seed(bucket, 'screenshot.png', 'run-1');
    await seed(bucket, 'rendered.md', 'run-1');

    const { response, body, browser } = await render(
      [contentAnswer(NORMAL_ARTICLE_PAGE)],
      { include_screenshot: true, include_markdown: true, ...RETRY },
      AUTH,
      bucket,
    );

    expect(response.status).toBe(200);
    expect(browser.quickAction).toHaveBeenCalledTimes(1);
    expect(browser.quickAction).toHaveBeenCalledWith('content', { url: TARGET_URL, gotoOptions: GOTO_OPTIONS });
    expect(putKinds(bucket)).toEqual(['rendered.html']);
    expect(kinds(body)).toEqual(['rendered.html', 'screenshot.png', 'rendered.md']);
    expect(body.meta?.reused).toEqual(['screenshot.png', 'rendered.md']);
  });

  it('still answers 403 access_blocked and stores nothing when the refill loads a challenge page', async () => {
    const bucket = memoryBucket();
    await seed(bucket, 'rendered.html', 'run-1');

    const { response, body } = await render(
      [snapshotAnswer({ content: CLOUDFLARE_CHALLENGE_PAGE, screenshot: PNG_BASE64, markdown: '# md' })],
      { include_screenshot: true, include_markdown: true, ...RETRY },
      AUTH,
      bucket,
    );

    expect(response.status).toBe(403);
    expect(body.reason).toBe('access_blocked');
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it.each([
    ['another run', 'run-0'],
    ['no run', undefined],
  ])('loads and stores everything again when the stored artifacts belong to %s', async (_label, scope) => {
    const bucket = memoryBucket();
    await seed(bucket, 'rendered.html', scope);
    await seed(bucket, 'screenshot.png', scope);
    await seed(bucket, 'rendered.md', scope);

    const { response, body, browser } = await render(
      [snapshotAnswer({ content: NORMAL_ARTICLE_PAGE, screenshot: PNG_BASE64, markdown: '# md' })],
      { include_screenshot: true, include_markdown: true, ...RETRY },
      AUTH,
      bucket,
    );

    expect(response.status).toBe(200);
    expect(browser.quickAction).toHaveBeenCalledTimes(1);
    expect(putKinds(bucket)).toEqual(['rendered.html', 'screenshot.png', 'rendered.md']);
    expect(body.meta).not.toHaveProperty('reused');
  });

  it('stores the snapshot artifacts before a rate-limited PDF load, so the retry makes only the PDF load', async () => {
    const bucket = memoryBucket();
    const flags = { include_screenshot: true, include_markdown: true, include_pdf: true, ...RETRY };

    const first = await render(
      [
        snapshotAnswer({ content: NORMAL_ARTICLE_PAGE, screenshot: PNG_BASE64, markdown: '# md' }),
        errorAnswer(429, { 'Retry-After': '1' }),
      ],
      flags,
      AUTH,
      bucket,
    );
    expect(first.response.status).toBe(429);
    expect(first.body).toMatchObject({ error: 'rate_limited' });
    expect(putKinds(bucket)).toEqual(['rendered.html', 'screenshot.png', 'rendered.md']);

    bucket.put.mockClear();
    const second = await render([pdfAnswer()], flags, AUTH, bucket);
    expect(second.response.status).toBe(200);
    expect(second.browser.quickAction).toHaveBeenCalledTimes(1);
    expect(second.browser.quickAction).toHaveBeenCalledWith('pdf', { url: TARGET_URL, gotoOptions: GOTO_OPTIONS });
    expect(putKinds(bucket)).toEqual(['page.pdf']);
    expect(kinds(second.body)).toEqual(['rendered.html', 'screenshot.png', 'page.pdf', 'rendered.md']);
  });

  it('never reads the bucket head on the first attempt, and still marks what it stores for a retry', async () => {
    const bucket = memoryBucket();

    const { response } = await render(
      [snapshotAnswer({ content: NORMAL_ARTICLE_PAGE, screenshot: PNG_BASE64 })],
      { ...RETRY, include_screenshot: true, first_attempt: true },
      AUTH,
      bucket,
    );

    expect(response.status).toBe(200);
    expect(bucket.head).not.toHaveBeenCalled();
    const stored = [...bucket.objects].find(([key]) => key.endsWith('/rendered.html'))?.[1];
    expect(stored?.customMetadata?.reuseScope).toBe('run-1');
  });

  it('never reads the bucket head without a reuse scope', async () => {
    const bucket = memoryBucket();
    await seed(bucket, 'rendered.html', 'run-1');

    const { response, browser } = await render([contentAnswer(NORMAL_ARTICLE_PAGE)], {}, AUTH, bucket);

    expect(response.status).toBe(200);
    expect(browser.quickAction).toHaveBeenCalledTimes(1);
    expect(bucket.head).not.toHaveBeenCalled();
    expect(putKinds(bucket)).toEqual(['rendered.html']);
  });
});

describe('one page load per render, with no reuse scope', () => {
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

  // Byte-exact copy of the stub archived by the 2026-09-04 canary: Chrome's
  // plain-text rendering of the proxy's DNS failure, served as HTTP 200.
  const DEAD_HOST_STUB =
    '<html><head><meta name="color-scheme" content="light dark"></head>' +
    '<body><pre style="word-wrap: break-word; white-space: pre-wrap;">' +
    'dial tcp: lookup www.explorminate.net on 1.1.1.1:53: no such host\n' +
    '</pre><div id="header-bqq3lsboese" style="display: none;"></div>' +
    '</body></html>';

  describe('kept responses', () => {
    it('answers 502 with the proxy-error reason and stores nothing for a proxy error page', async () => {
      const { env, browser, bucket } = makeEnv([
        snapshotAnswer({ content: DEAD_HOST_STUB, screenshot: PNG_BASE64, markdown: 'dial tcp' })
      ]);

      const { response, json } = await render(ALL_ON, env);

      expect(response.status).toBe(502);
      expect(json).toEqual({
        error: 'Browser Rendering /content returned a proxy/network error page',
        reason: PROXY_ERROR_PAGE_REASON,
        detail: 'dial tcp: lookup www.explorminate.net on 1.1.1.1:53: no such host',
        url: TARGET_URL
      });
      expect(bucket.put).not.toHaveBeenCalled();
      expect(browser.quickAction).toHaveBeenCalledTimes(1);
    });

    it('answers 429 with the Retry-After delay when the page load is rate limited', async () => {
      const { env, bucket } = makeEnv([errorAnswer(429, { 'Retry-After': '7' })]);

      const { response, json } = await render(ALL_ON, env);

      expect(response.status).toBe(429);
      expect(json).toEqual({ error: 'rate_limited', retry_after_ms: 7000, message: 'Browser Rendering rate limited' });
      expect(bucket.put).not.toHaveBeenCalled();
    });

    it('defaults the rate-limit delay to 5000 ms with no Retry-After', async () => {
      const { env } = makeEnv([errorAnswer(429)]);

      const { response, json } = await render(ALL_ON, env);

      expect(response.status).toBe(429);
      expect(json.retry_after_ms).toBe(5000);
    });

    it('answers 429 when the pdf load is rate limited', async () => {
      const { env } = makeEnv([
        snapshotAnswer({ content: PAGE_HTML, screenshot: PNG_BASE64, markdown: PAGE_MARKDOWN }),
        errorAnswer(429, { 'Retry-After': '3' })
      ]);

      const { response, json } = await render(ALL_ON, env);

      expect(response.status).toBe(429);
      expect(json).toEqual({ error: 'rate_limited', retry_after_ms: 3000, message: 'Browser Rendering rate limited on PDF' });
    });

    it.each([502, 403])('answers 502 with the content failure body when the html load answers %i', async (status) => {
      const failure = errorAnswer(status);
      const details = await failure.clone().text();
      const { env } = makeEnv([failure]);

      const { response, json } = await render(
        { ...ALL_ON, include_screenshot: false, include_pdf: false, include_markdown: false },
        env
      );

      expect(response.status).toBe(502);
      expect(json).toEqual({ error: 'Browser Rendering /content failed', status, details });
    });

    it('answers 502 with the content failure body when the html retry after a failed snapshot fails', async () => {
      const { env, browser } = makeEnv([errorAnswer(500), errorAnswer(503)]);

      const { response, json } = await render(ALL_ON, env);

      expect(response.status).toBe(502);
      expect(json.error).toBe('Browser Rendering /content failed');
      expect(json.status).toBe(503);
      expect(browser.quickAction.mock.calls.map(([action]) => action)).toEqual(['snapshot', 'content']);
    });

    it('answers 502 with status 403 and no html retry when the snapshot answers 403', async () => {
      const failure = errorAnswer(403);
      const details = await failure.clone().text();
      const { env, browser } = makeEnv([failure]);

      const { response, json } = await render(ALL_ON, env);

      expect(response.status).toBe(502);
      expect(json).toEqual({ error: 'Browser Rendering /content failed', status: 403, details });
      expect(browser.quickAction).toHaveBeenCalledTimes(1);
    });

    it('answers 502 when the page load returns no html', async () => {
      const { env } = makeEnv([snapshotAnswer({ screenshot: PNG_BASE64 })]);

      const { response, json } = await render(ALL_ON, env);

      expect(response.status).toBe(502);
      expect(json).toEqual({ error: 'Browser Rendering /content returned invalid response' });
    });

    it('answers 404 for anything but POST /render', async () => {
      const { env } = makeEnv([]);
      expect((await render(ALL_ON, env, { path: '/other' })).response.status).toBe(404);
      expect((await render(ALL_ON, env, { method: 'GET' })).response.status).toBe(404);
    });

    it('answers 401 without a valid internal key', async () => {
      const { env } = makeEnv([]);
      expect((await render(ALL_ON, env, { key: null })).response.status).toBe(401);
      expect((await render(ALL_ON, env, { key: 'wrong-key' })).response.status).toBe(401);
    });

    it('answers 400 for a body that is not JSON', async () => {
      const { env } = makeEnv([]);
      const { response, json } = await render('{not json', env);
      expect(response.status).toBe(400);
      expect(json).toEqual({ error: 'Invalid JSON' });
    });

    it('answers 400 when a required field is missing', async () => {
      const { env, browser } = makeEnv([]);
      const { response, json } = await render({ ...ALL_ON, url: undefined }, env);
      expect(response.status).toBe(400);
      expect(json).toEqual({ error: 'Missing required fields: request_id, url, browser_quota_kind' });
      expect(browser.quickAction).not.toHaveBeenCalled();
    });
  });
});
