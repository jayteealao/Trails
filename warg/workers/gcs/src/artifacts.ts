import type { ArtifactMeta, ArtifactKind } from '@warg/shared';
import type { ArtifactUploadInfo } from './types.js';
import { ARTIFACT_PATH_MAP } from './types.js';

/**
 * Artifact kinds that should be gzip-compressed before upload.
 * Excludes JSON (for easy access) and binary files (already compressed).
 */
export const COMPRESSIBLE_KINDS = new Set<ArtifactKind>([
  'singlefile.html',
  'monolith.html',
  'rendered.html',
  'rendered.md',
  'readability.md'
]);

/**
 * Check if an artifact kind should be gzip-compressed.
 */
export function shouldCompress(kind: ArtifactKind): boolean {
  return COMPRESSIBLE_KINDS.has(kind);
}

/**
 * Get the GCS path for an artifact.
 */
export function getGcsPath(requestId: string, kind: ArtifactKind): { folder: string; filename: string; path: string } {
  const mapping = ARTIFACT_PATH_MAP[kind];
  if (!mapping) {
    throw new Error(`Unknown artifact kind: ${kind}`);
  }
  return {
    folder: mapping.folder,
    filename: mapping.filename,
    path: `archives/${requestId}/${mapping.folder}/${mapping.filename}`
  };
}

/**
 * Filter artifacts to those persisted to GCS.
 * Excludes manifest.json (not persisted to GCS).
 * Note: readability.json IS uploaded to GCS (for archival) but has no Firestore
 * archive entry — its data populates the metadata field instead.
 */
export function filterPersistableArtifacts(artifacts: ArtifactMeta[]): ArtifactMeta[] {
  return artifacts.filter((a) => a.kind !== 'manifest.json');
}

/**
 * Convert ArtifactMeta to ArtifactUploadInfo for Cloud Function.
 */
export function toUploadInfo(requestId: string, artifact: ArtifactMeta): ArtifactUploadInfo {
  const { filename } = getGcsPath(requestId, artifact.kind);
  const compressed = shouldCompress(artifact.kind);
  return {
    kind: artifact.kind,
    filename,
    bytes: artifact.bytes,
    contentType: artifact.contentType,
    sha256: artifact.sha256,
    ...(compressed && { compressed })
  };
}
