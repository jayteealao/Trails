import { beforeEach, describe, expect, it, vi } from 'vitest';
import puppeteer from '@cloudflare/puppeteer';
import { getR2Key } from '@warg/shared';
import worker from './index.js';

vi.mock('@cloudflare/puppeteer', () => ({ default: { launch: vi.fn() } }));

const KEY = 'test-internal-key';
const TARGET_URL = 'https://example.com/a';

/** A puppeteer page whose navigation answers `status`, or `null` when `status` is undefined. */
function fakePage(status: number | undefined) {
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
      .mockResolvedValueOnce({ content: 'x'.repeat(200) }), // capture
  };
}

async function runCapture(status: number | undefined) {
  const page = fakePage(status);
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
