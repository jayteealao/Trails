import { afterEach, describe, expect, it, vi } from 'vitest';
import { callCloudFunction } from './cloud-function.js';

const env = {
  CLOUD_FN_BASE_URL: 'https://fn.example.test/archive-gateway',
  ARCHIVE_GATEWAY_KEY: 'gcs-k',
  // The worker's inbound worker-to-worker key; it must never reach the function.
  INTERNAL_API_KEY: 'old-k'
};

function stubFetch(response: Response) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('callCloudFunction', () => {
  it('posts to the function path with the storage worker key', async () => {
    const fetchMock = stubFetch(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    const result = await callCloudFunction<{ ok: boolean }>(env, '/create-upload', { a: 1 });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://fn.example.test/archive-gateway/create-upload');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers['X-Internal-API-Key']).toBe('gcs-k');
    expect(Object.values(headers)).not.toContain('old-k');
    expect(init?.body).toBe(JSON.stringify({ a: 1 }));
  });

  it('throws with the path and status on a non-OK response', async () => {
    stubFetch(new Response('denied', { status: 401 }));

    await expect(callCloudFunction(env, '/finalize', {})).rejects.toThrow(
      'Cloud Function /finalize failed: 401 - denied'
    );
  });

  it('throws before any fetch when its key is empty', async () => {
    const fetchMock = stubFetch(new Response('{}', { status: 200 }));

    await expect(
      callCloudFunction({ ...env, ARCHIVE_GATEWAY_KEY: '' }, '/finalize', {})
    ).rejects.toThrow('ARCHIVE_GATEWAY_KEY is not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
