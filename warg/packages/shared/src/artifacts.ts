import type { ArtifactKind, ArtifactMeta } from './types.js';
import { getR2Key } from './r2Keys.js';
import { sha256 } from './crypto.js';

/**
 * Minimal bucket interface for R2 put operations.
 * Structurally compatible with Cloudflare R2Bucket.
 */
export interface ArtifactBucket {
  put(
    key: string,
    value: ArrayBuffer,
    options?: { httpMetadata?: { contentType: string } }
  ): Promise<unknown>;
}

/**
 * Store an artifact to R2 and return metadata.
 * Centralized implementation used by renderer, readability, singlefile, and monolith workers.
 */
export async function storeArtifact(
  bucket: ArtifactBucket,
  requestId: string,
  kind: ArtifactKind,
  data: ArrayBuffer,
  contentType: string
): Promise<ArtifactMeta> {
  const r2Key = getR2Key(requestId, kind);
  const hash = await sha256(data);
  await bucket.put(r2Key, data, {
    httpMetadata: { contentType }
  });
  return {
    kind,
    r2Key,
    bytes: data.byteLength,
    sha256: hash,
    contentType
  };
}
