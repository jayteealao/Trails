import type { ArtifactKind } from '@warg/shared';

/**
 * Request body for POST /persist.
 */
export interface PersistRequest {
  request_id: string;
  manifest_key: string;
  dryRun?: boolean;
}

/**
 * Artifact info sent to Cloud Function for upload URL generation.
 */
export interface ArtifactUploadInfo {
  kind: ArtifactKind;
  filename: string;
  bytes: number;
  contentType: string;
  sha256: string;
  /** Indicates the artifact will be uploaded with gzip Content-Encoding. */
  compressed?: boolean;
}

/**
 * Request to Cloud Function /create-upload.
 */
export interface CreateUploadRequest {
  request_id: string;
  url: string;
  artifacts: ArtifactUploadInfo[];
}

/**
 * Single upload entry from Cloud Function.
 */
export interface UploadEntry {
  kind: ArtifactKind;
  signed_url: string;
  gcs_path: string;
  expires_at: string;
}

/**
 * Response from Cloud Function /create-upload.
 */
export interface CreateUploadResponse {
  firestore_doc_id: string;
  uploads: UploadEntry[];
}

/**
 * Single uploaded artifact info for finalize.
 */
export interface UploadedArtifact {
  kind: ArtifactKind;
  gcs_path: string;
  bytes: number;
  sha256: string;
  content_type: string;
}

/**
 * Request to Cloud Function /finalize.
 */
export interface FinalizeRequest {
  request_id: string;
  firestore_doc_id: string;
  uploaded: UploadedArtifact[];
}

/**
 * Response from Cloud Function /finalize.
 */
export interface FinalizeResponse {
  success: boolean;
  firestore_doc_id: string;
  status: string;
}

/**
 * Uploaded artifact result for response.
 */
export interface UploadedArtifactResult {
  kind: ArtifactKind;
  gcs_path: string;
}

/**
 * Compression stats for a single artifact.
 */
export interface CompressionStat {
  kind: string;
  originalBytes: number;
  compressedBytes: number;
  ratio: number;
}

/**
 * Response from POST /persist.
 */
export interface PersistResponse {
  success: boolean;
  firestore_doc_id: string;
  uploaded: number;
  artifacts: UploadedArtifactResult[];
  meta?: {
    compressionStats: CompressionStat[];
    uploadDurationMs: number;
    skippedArtifacts: string[];
  };
}

/**
 * Mapping from artifact kind to GCS path components.
 */
export const ARTIFACT_PATH_MAP: Record<string, { folder: string; filename: string }> = {
  'singlefile.html': { folder: 'singlefile', filename: 'output.html' },
  'monolith.html': { folder: 'monolith', filename: 'output.html' },
  'readability.json': { folder: 'readability', filename: 'output.json' },
  'readability.md': { folder: 'readability', filename: 'output.md' },
  'page.pdf': { folder: 'pdf', filename: 'output.pdf' },
  'screenshot.png': { folder: 'screenshot', filename: 'output.png' },
  'rendered.html': { folder: 'rendered', filename: 'output.html' },
  'rendered.md': { folder: 'rendered', filename: 'output.md' }
};
