import { describe, expect, it } from 'vitest';
import { buildR2ObjectUrl, presignR2GetUrl, presignR2PutUrl, type R2PresignConfig } from './r2-presign.js';

const CONFIG: R2PresignConfig = {
  accessKeyId: 'test-access-key-id',
  secretAccessKey: 'test-secret-access-key',
  accountId: 'abc123account',
  bucket: 'warg-archives'
};

describe('buildR2ObjectUrl', () => {
  it('builds a path-style S3 URL, keeping key slashes as separators', () => {
    const url = buildR2ObjectUrl('abc123account', 'warg-archives', 'archives/req-1/raw/rendered.html');
    expect(url).toBe(
      'https://abc123account.r2.cloudflarestorage.com/warg-archives/archives/req-1/raw/rendered.html'
    );
  });

  it('percent-encodes special characters within a segment but not the slash', () => {
    const url = buildR2ObjectUrl('acct', 'bkt', 'a b/c+d/e.html');
    expect(url).toBe('https://acct.r2.cloudflarestorage.com/bkt/a%20b/c%2Bd/e.html');
  });
});

describe('presignR2GetUrl', () => {
  it('produces a SigV4 query-signed GET URL for the object', async () => {
    const signed = await presignR2GetUrl(CONFIG, 'archives/req-1/raw/rendered.html', 900);
    const url = new URL(signed);

    expect(url.origin).toBe('https://abc123account.r2.cloudflarestorage.com');
    expect(url.pathname).toBe('/warg-archives/archives/req-1/raw/rendered.html');
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
    expect(url.searchParams.get('X-Amz-Credential')).toContain('test-access-key-id');
    // Credential scope is the R2 S3 region.
    expect(url.searchParams.get('X-Amz-Credential')).toContain('auto/s3/aws4_request');
  });

  it('defaults the TTL to 15 minutes', async () => {
    const signed = await presignR2GetUrl(CONFIG, 'archives/x/raw/rendered.html');
    expect(new URL(signed).searchParams.get('X-Amz-Expires')).toBe('900');
  });
});

describe('presignR2PutUrl', () => {
  it('signs a PUT for the object (distinct signature from GET)', async () => {
    const key = 'archives/req-1/derived/monolith.html';
    const put = await presignR2PutUrl(CONFIG, key);
    const get = await presignR2GetUrl(CONFIG, key);
    const putUrl = new URL(put);

    expect(putUrl.pathname).toBe('/warg-archives/archives/req-1/derived/monolith.html');
    expect(putUrl.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(putUrl.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
    // The HTTP verb is part of the signed canonical request, so PUT != GET.
    expect(putUrl.searchParams.get('X-Amz-Signature')).not.toBe(
      new URL(get).searchParams.get('X-Amz-Signature')
    );
  });
});
