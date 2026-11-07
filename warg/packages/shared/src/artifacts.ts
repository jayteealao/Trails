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
    options?: { httpMetadata?: { contentType: string }; customMetadata?: Record<string, string> }
  ): Promise<unknown>;
}

/**
 * Minimal bucket interface for R2 head operations.
 * Structurally compatible with Cloudflare R2Bucket.
 */
export interface ArtifactHeadBucket {
  head(key: string): Promise<{
    size: number;
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
  } | null>;
}

/**
 * Store an artifact to R2 and return metadata.
 * Centralized implementation used by renderer, readability, singlefile, and monolith workers.
 *
 * With a `reuseScope` (the run that stores it), the object also carries its sha256 and
 * that scope, so a later attempt of the same run can reuse it via findReusableArtifact().
 */
export async function storeArtifact(
  bucket: ArtifactBucket,
  requestId: string,
  kind: ArtifactKind,
  data: ArrayBuffer,
  contentType: string,
  reuseScope?: string
): Promise<ArtifactMeta> {
  const r2Key = getR2Key(requestId, kind);
  const hash = await sha256(data);
  await bucket.put(r2Key, data, {
    httpMetadata: { contentType },
    ...(reuseScope !== undefined && { customMetadata: { sha256: hash, reuseScope } })
  });
  return {
    kind,
    r2Key,
    bytes: data.byteLength,
    sha256: hash,
    contentType
  };
}

/**
 * Answer the meta of an artifact that an earlier attempt of the same run stored,
 * or undefined when it must be loaded again: missing, empty, stored by another run,
 * or stored without a reuse scope.
 */
export async function findReusableArtifact(
  bucket: ArtifactHeadBucket,
  requestId: string,
  kind: ArtifactKind,
  reuseScope: string
): Promise<ArtifactMeta | undefined> {
  const r2Key = getR2Key(requestId, kind);
  const head = await bucket.head(r2Key);
  const hash = head?.customMetadata?.sha256;
  if (!head || head.size === 0 || !hash || head.customMetadata?.reuseScope !== reuseScope) {
    return undefined;
  }
  return {
    kind,
    r2Key,
    bytes: head.size,
    sha256: hash,
    contentType: head.httpMetadata?.contentType ?? 'application/octet-stream'
  };
}
