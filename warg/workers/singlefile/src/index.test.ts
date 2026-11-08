import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
