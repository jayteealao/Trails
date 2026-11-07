import { describe, it, expect, vi } from 'vitest';
import { storeArtifact, findReusableArtifact } from './artifacts.js';
import { getR2Key } from './r2Keys.js';
import { sha256 } from './crypto.js';

interface StoredObject {
  data: ArrayBuffer;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
}

function memoryBucket() {
  const objects = new Map<string, StoredObject>();
  return {
    objects,
    put: vi.fn(
      async (
        key: string,
        data: ArrayBuffer,
        options?: { httpMetadata?: { contentType: string }; customMetadata?: Record<string, string> }
      ) => {
        objects.set(key, { data, httpMetadata: options?.httpMetadata, customMetadata: options?.customMetadata });
        return {};
      }
    ),
    head: vi.fn(async (key: string) => {
      const object = objects.get(key);
      if (!object) return null;
      return {
        size: object.data.byteLength,
        httpMetadata: object.httpMetadata,
        customMetadata: object.customMetadata,
      };
    }),
  };
}

const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

describe('storeArtifact', () => {
  it('writes only the content type when no reuse scope is given', async () => {
    const bucket = memoryBucket();
    await storeArtifact(bucket, 'req-1', 'rendered.html', bytes('<p>hi</p>'), 'text/html');

    expect(bucket.put).toHaveBeenCalledTimes(1);
    expect(bucket.put.mock.calls[0]?.[2]).toStrictEqual({ httpMetadata: { contentType: 'text/html' } });
  });

  it('marks the object with its sha256 and the reuse scope when one is given', async () => {
    const bucket = memoryBucket();
    const data = bytes('<p>hi</p>');
    const meta = await storeArtifact(bucket, 'req-1', 'rendered.html', data, 'text/html', 'run-1');
    const hash = await sha256(data);

    expect(bucket.put.mock.calls[0]?.[2]).toStrictEqual({
      httpMetadata: { contentType: 'text/html' },
      customMetadata: { sha256: hash, reuseScope: 'run-1' },
    });
    expect(meta).toStrictEqual({
      kind: 'rendered.html',
      r2Key: getR2Key('req-1', 'rendered.html'),
      bytes: data.byteLength,
      sha256: hash,
      contentType: 'text/html',
    });
  });
});

describe('findReusableArtifact', () => {
  it('answers the meta an earlier attempt of the same scope stored', async () => {
    const bucket = memoryBucket();
    const stored = await storeArtifact(bucket, 'req-1', 'screenshot.png', bytes('png-bytes'), 'image/png', 'run-1');

    await expect(findReusableArtifact(bucket, 'req-1', 'screenshot.png', 'run-1')).resolves.toStrictEqual(stored);
  });

  it('answers nothing for a missing object', async () => {
    const bucket = memoryBucket();

    await expect(findReusableArtifact(bucket, 'req-1', 'rendered.md', 'run-1')).resolves.toBeUndefined();
  });

  it('answers nothing for an object of another scope', async () => {
    const bucket = memoryBucket();
    await storeArtifact(bucket, 'req-1', 'rendered.md', bytes('# hi'), 'text/markdown', 'run-0');

    await expect(findReusableArtifact(bucket, 'req-1', 'rendered.md', 'run-1')).resolves.toBeUndefined();
  });

  it('answers nothing for an empty object', async () => {
    const bucket = memoryBucket();
    await storeArtifact(bucket, 'req-1', 'rendered.html', new ArrayBuffer(0), 'text/html', 'run-1');

    await expect(findReusableArtifact(bucket, 'req-1', 'rendered.html', 'run-1')).resolves.toBeUndefined();
  });

  it('answers nothing for an object stored without a reuse scope', async () => {
    const bucket = memoryBucket();
    await storeArtifact(bucket, 'req-1', 'page.pdf', bytes('%PDF-1.4'), 'application/pdf');

    await expect(findReusableArtifact(bucket, 'req-1', 'page.pdf', 'run-1')).resolves.toBeUndefined();
  });

  it('answers nothing for an object of the scope that carries no sha256', async () => {
    const bucket = memoryBucket();
    bucket.objects.set(getR2Key('req-1', 'page.pdf'), {
      data: bytes('%PDF-1.4'),
      httpMetadata: { contentType: 'application/pdf' },
      customMetadata: { reuseScope: 'run-1' },
    });

    await expect(findReusableArtifact(bucket, 'req-1', 'page.pdf', 'run-1')).resolves.toBeUndefined();
  });
});
