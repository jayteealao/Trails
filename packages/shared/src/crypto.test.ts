import { describe, it, expect } from 'vitest';
import { sha256 } from './crypto.js';

describe('sha256', () => {
  it('hashes empty input to known value', async () => {
    const data = new Uint8Array(0);
    const hash = await sha256(data);
    expect(hash).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('hashes "hello" to known value', async () => {
    const data = new TextEncoder().encode('hello');
    const hash = await sha256(data);
    expect(hash).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });

  it('returns lowercase hex string of 64 characters', async () => {
    const data = new TextEncoder().encode('test');
    const hash = await sha256(data);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
