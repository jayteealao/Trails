import { describe, expect, it, vi } from 'vitest';
import { getR2Key } from '@warg/shared';
import worker from './index.js';
import html from './__fixtures__/article.html?raw';
import golden from './__fixtures__/readability.golden.md?raw';

// The golden is the readability.md that the worker stored for the fixture
// article before the reader-text change. It pins those bytes: never regenerate
// it to make a change pass. A change that alters it is a regression.

const REQUEST_ID = 'golden-fixture-request';
const RENDERED_KEY = getR2Key(REQUEST_ID, 'rendered.html');

const bucket = {
  get: vi.fn(async (key: string) =>
    key === RENDERED_KEY ? { text: async () => html } : null
  ),
  put: vi.fn<(key: string, data: ArrayBuffer) => Promise<undefined>>(
    async () => undefined
  ),
  head: vi.fn()
};
// The fake bucket carries only the methods the handler reaches; the rest of
// the R2 surface is never touched.
const env = {
  INTERNAL_API_KEY: 'test-key',
  ARCHIVE_BUCKET: bucket
} as unknown as Env;
const ctx = {} as ExecutionContext;

describe('readability.md golden file', () => {
  it('stores the fixture article byte-identical to the golden', async () => {
    expect(
      golden.includes('\r'),
      'the golden has a CR byte: the -text rule in __fixtures__/.gitattributes was not applied at checkout'
    ).toBe(false);

    const res = await worker.fetch(
      new Request('https://readability/readability', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-API-Key': 'test-key'
        },
        body: JSON.stringify({
          request_id: REQUEST_ID,
          rendered_html_key: RENDERED_KEY,
          url: 'https://journal.example/notes/slow-garden'
        })
      }),
      env,
      ctx
    );

    expect(res.status).toBe(200);
    const mdKey = getR2Key(REQUEST_ID, 'readability.md');
    const storedMd = bucket.put.mock.calls
      .filter(([key]) => key === mdKey)
      .map(([, data]) => new Uint8Array(data));
    // Exactly one readability.md put, and its bytes are the golden's bytes.
    expect(storedMd).toEqual([new TextEncoder().encode(golden)]);
  });
});
