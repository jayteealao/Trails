import { describe, expect, it } from 'vitest';
import { decodeBase64ToArrayBuffer } from './base64.js';

function bytes(buffer: ArrayBuffer): number[] {
  return Array.from(new Uint8Array(buffer));
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('decodeBase64ToArrayBuffer', () => {
  it('decodes standard base64', () => {
    expect(new TextDecoder().decode(decodeBase64ToArrayBuffer('aGVsbG8gd29ybGQ='))).toBe('hello world');
  });

  it('decodes base64url', () => {
    expect(bytes(decodeBase64ToArrayBuffer('-_8'))).toEqual([0xfb, 0xff]);
  });

  it('adds missing padding', () => {
    expect(new TextDecoder().decode(decodeBase64ToArrayBuffer('aGVsbG8'))).toBe('hello');
  });

  it('ignores embedded whitespace', () => {
    expect(new TextDecoder().decode(decodeBase64ToArrayBuffer('aGVs\nbG8g\r\nd29y bGQ='))).toBe('hello world');
  });

  it('round-trips the PNG signature bytes', () => {
    const encoded = btoa(String.fromCharCode(...PNG_SIGNATURE));
    expect(bytes(decodeBase64ToArrayBuffer(encoded))).toEqual(PNG_SIGNATURE);
  });
});
