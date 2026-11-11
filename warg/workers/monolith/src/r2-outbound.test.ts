import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleR2Outbound, monolithKeys, R2_HANDLER_HOST, r2HandlerUrl, type R2OutboundDeps } from './r2-outbound.js';

const MIB_20 = 20 * 1024 * 1024;
const CHUNK = 64 * 1024;

/** A stream of `total` bytes in 64 KiB chunks, made on demand (never one buffer). */
function chunkedStream(total: number): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= total) {
        controller.close();
        return;
      }
      const size = Math.min(CHUNK, total - sent);
      sent += size;
      controller.enqueue(new Uint8Array(size));
    }
  });
}

async function countBytes(stream: ReadableStream<Uint8Array>): Promise<number> {
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return total;
    total += value.byteLength;
  }
}

/** An R2 object body whose whole-body readers throw, so only streaming works. */
function streamingObject(total: number): { body: ReadableStream<Uint8Array>; size: number; httpMetadata: { contentType: string }; arrayBuffer: () => never; text: () => never } {
  return {
    body: chunkedStream(total),
    size: total,
    httpMetadata: { contentType: 'text/html' },
    arrayBuffer: () => {
      throw new Error('buffered read');
    },
    text: () => {
      throw new Error('buffered read');
    }
  };
}

const REQUEST_ID = 'req-1';
const CONTAINER = 'container-of-req-1';

function makeDeps(object?: ReturnType<typeof streamingObject>) {
  const get = vi.fn(async () => object ?? null);
  const put = vi.fn(async (_key: string, value: unknown) => {
    if (value instanceof ReadableStream) await countBytes(value);
    return null;
  });
  const knownLength = vi.fn((body: ReadableStream<Uint8Array>, _bytes: number) => body);
  const deps: R2OutboundDeps = {
    // Test boundary: the fakes implement only the parts of R2Bucket the handler calls.
    bucket: { get, put } as unknown as R2OutboundDeps['bucket'],
    containerId: CONTAINER,
    containerIdForRequest: id => `container-of-${id}`,
    knownLength
  };
  return { deps, get, put, knownLength };
}

const { input, output } = monolithKeys(REQUEST_ID);

describe('handleR2Outbound refusals', () => {
  const cases: Array<[string, string, string, string, string]> = [
    ['another request\'s key', 'GET', r2HandlerUrl(monolithKeys('req-2').input), CONTAINER, 'foreign_container'],
    ['the right key from the wrong container', 'GET', r2HandlerUrl(input), 'container-of-req-2', 'foreign_container'],
    ['a PUT to the input', 'PUT', r2HandlerUrl(input), CONTAINER, 'method_or_key'],
    ['a GET of the output', 'GET', r2HandlerUrl(output), CONTAINER, 'method_or_key'],
    ['an unrelated key', 'GET', r2HandlerUrl('archives/req-1/manifest.json'), CONTAINER, 'key_shape'],
    ['a path traversal', 'GET', `http://${R2_HANDLER_HOST}/archives/req-1/../req-2/raw/rendered.html`, CONTAINER, 'foreign_container'],
    ['an encoded slash in the id', 'GET', `http://${R2_HANDLER_HOST}/archives/req-2%2Fx/raw/rendered.html`, CONTAINER, 'key_shape'],
    ['a dot-dot request id', 'GET', `http://${R2_HANDLER_HOST}/archives/%2E%2E/raw/rendered.html`, CONTAINER, 'key_shape'],
    ['an invalid escape', 'GET', `http://${R2_HANDLER_HOST}/archives/%E0%A4%A/raw/rendered.html`, CONTAINER, 'bad_encoding'],
    ['another host', 'GET', `http://example.com/${input}`, CONTAINER, 'host']
  ];

  it.each(cases)('answers 403 to %s and reads no object', async (_name, method, url, containerId, reason) => {
    const { deps, get, put } = makeDeps(streamingObject(10));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const init: RequestInit = method === 'PUT' ? { method, body: 'x', headers: { 'content-length': '1' } } : { method };
    const response = await handleR2Outbound(new Request(url, init), { ...deps, containerId });
    expect(response.status).toBe(403);
    expect(get).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    // The warning names the rule that refused the request and the container that sent it.
    expect(warn).toHaveBeenCalledWith('[monolith] r2 handler', expect.objectContaining({ status: 403, reason, containerId }));
    warn.mockRestore();
  });
});

describe('handleR2Outbound streams', () => {
  it('serves a 20 MiB GET as the object stream, never a buffered read', async () => {
    const object = streamingObject(MIB_20);
    const { deps, get } = makeDeps(object);
    const response = await handleR2Outbound(new Request(r2HandlerUrl(input)), deps);
    expect(response.status).toBe(200);
    expect(get).toHaveBeenCalledWith(input);
    expect(response.headers.get('content-length')).toBe(String(MIB_20));
    expect(response.body).not.toBeNull();
    expect(await countBytes(response.body!)).toBe(MIB_20);
  });

  it('passes a 20 MiB PUT body to R2 as a stream of known length', async () => {
    const { deps, put, knownLength } = makeDeps();
    const request = new Request(r2HandlerUrl(output), {
      method: 'PUT',
      body: chunkedStream(MIB_20),
      headers: { 'content-length': String(MIB_20) },
      // Node's fetch needs half-duplex to send a stream body.
      duplex: 'half'
    } as RequestInit);
    const response = await handleR2Outbound(request, deps);
    expect(response.status).toBe(201);
    expect(knownLength).toHaveBeenCalledWith(expect.any(ReadableStream), MIB_20);
    expect(put).toHaveBeenCalledTimes(1);
    const [key, value] = put.mock.calls[0]!;
    expect(key).toBe(output);
    expect(value).toBeInstanceOf(ReadableStream);
  });

  it('counts every byte of the PUT body that R2 reads', async () => {
    let counted = 0;
    const { deps } = makeDeps();
    const bucket = {
      get: vi.fn(),
      put: vi.fn(async (_key: string, value: ReadableStream<Uint8Array>) => {
        counted = await countBytes(value);
        return null;
      })
    };
    const request = new Request(r2HandlerUrl(output), {
      method: 'PUT',
      body: chunkedStream(MIB_20),
      headers: { 'content-length': String(MIB_20) },
      duplex: 'half'
    } as RequestInit);
    // Test boundary: a fake bucket with the two methods the handler calls.
    await handleR2Outbound(request, { ...deps, bucket: bucket as unknown as R2OutboundDeps['bucket'] });
    expect(counted).toBe(MIB_20);
  });
});

describe('handleR2Outbound answers', () => {
  it('answers 411 to a PUT without a Content-Length and stores nothing', async () => {
    const { deps, put } = makeDeps();
    const request = new Request(r2HandlerUrl(output), {
      method: 'PUT',
      body: chunkedStream(10),
      duplex: 'half'
    } as RequestInit);
    const response = await handleR2Outbound(request, deps);
    expect(response.status).toBe(411);
    expect(put).not.toHaveBeenCalled();
  });

  it('answers 404 to a GET of a missing object', async () => {
    const { deps } = makeDeps();
    const response = await handleR2Outbound(new Request(r2HandlerUrl(input)), deps);
    expect(response.status).toBe(404);
  });

  it('answers 502 when R2 fails', async () => {
    const { deps } = makeDeps();
    const bucket = { get: vi.fn(async () => { throw new Error('r2 down'); }), put: vi.fn() };
    // Test boundary: a fake bucket with the two methods the handler calls.
    const response = await handleR2Outbound(new Request(r2HandlerUrl(input)), { ...deps, bucket: bucket as unknown as R2OutboundDeps['bucket'] });
    expect(response.status).toBe(502);
  });
});

describe('handleR2Outbound log', () => {
  let log: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });

  it('logs one line naming the method, host, request id, key and status', async () => {
    const { deps } = makeDeps(streamingObject(10));
    await handleR2Outbound(new Request(r2HandlerUrl(input)), deps);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('[monolith] r2 handler', {
      method: 'GET',
      host: R2_HANDLER_HOST,
      containerId: CONTAINER,
      requestId: REQUEST_ID,
      key: input,
      status: 200
    });
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('logs a refusal as one warning with a bounded key', async () => {
    const { deps } = makeDeps();
    const longKey = `archives/${'x'.repeat(500)}`;
    await handleR2Outbound(new Request(`http://${R2_HANDLER_HOST}/${longKey}`), deps);
    expect(log).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const [, line] = warn.mock.calls[0] as [string, { key: string; status: number; reason: string }];
    expect(line.status).toBe(403);
    expect(line.reason).toBe('key_shape');
    expect(line.key).toHaveLength(200);
  });

  it('logs an R2 failure as one error line that carries the R2 error', async () => {
    const { deps } = makeDeps();
    const bucket = { get: vi.fn(async () => { throw new Error('r2 down'); }), put: vi.fn() };
    // Test boundary: a fake bucket with the two methods the handler calls.
    await handleR2Outbound(new Request(r2HandlerUrl(input)), { ...deps, bucket: bucket as unknown as R2OutboundDeps['bucket'] });
    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('[monolith] r2 handler', expect.objectContaining({ status: 502, error: 'r2 down', requestId: REQUEST_ID }));
  });
});

describe('r2HandlerUrl', () => {
  it('encodes each segment and keeps the slashes', () => {
    expect(r2HandlerUrl('archives/a b/raw/rendered.html')).toBe(
      'http://r2.monolith.internal/archives/a%20b/raw/rendered.html'
    );
  });
});
