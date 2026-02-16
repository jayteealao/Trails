import { describe, expect, it } from 'vitest';
import { decodeBinaryPayload, decodeBase64ToArrayBuffer } from './payload-decode.js';

function toText(data: ArrayBuffer): string {
  return new TextDecoder().decode(new Uint8Array(data));
}

describe('decodeBase64ToArrayBuffer', () => {
  it('decodes standard base64 payload', () => {
    const encoded = Buffer.from('hello world', 'utf8').toString('base64');
    const decoded = decodeBase64ToArrayBuffer(encoded);
    expect(toText(decoded)).toBe('hello world');
  });

  it('decodes url-safe base64 payload', () => {
    const encoded = Buffer.from('hello_world', 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');

    const decoded = decodeBase64ToArrayBuffer(encoded);
    expect(toText(decoded)).toBe('hello_world');
  });
});

describe('decodeBinaryPayload', () => {
  it('decodes data URL payloads', async () => {
    const encoded = Buffer.from('test-data', 'utf8').toString('base64');
    const decoded = await decodeBinaryPayload(`data:image/png;base64,${encoded}`);

    expect(decoded.source).toBe('data_url');
    expect(decoded.contentType).toBe('image/png');
    expect(toText(decoded.data)).toBe('test-data');
  });

  it('decodes raw base64 payloads', async () => {
    const encoded = Buffer.from('raw-base64', 'utf8').toString('base64');
    const decoded = await decodeBinaryPayload(encoded);

    expect(decoded.source).toBe('base64');
    expect(decoded.contentType).toBe('application/octet-stream');
    expect(toText(decoded.data)).toBe('raw-base64');
  });

  it('downloads URL payloads', async () => {
    const fetchMock: typeof fetch = async () =>
      new Response('img-bytes', {
        status: 200,
        headers: {
          'content-type': 'image/png',
        },
      });

    const decoded = await decodeBinaryPayload('https://example.com/image.png', fetchMock);

    expect(decoded.source).toBe('url');
    expect(decoded.contentType).toBe('image/png');
    expect(toText(decoded.data)).toBe('img-bytes');
  });

  it('throws on invalid data URL payload', async () => {
    await expect(decodeBinaryPayload('data:image/png;base64')).rejects.toThrow(
      'Invalid data URL payload',
    );
  });
});
