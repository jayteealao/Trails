// GCS worker contract — keep in sync with workers/gcs/src/types.ts

import type { GatewayArchiveKey } from '@warg/article-writer';

/**
 * Log level for events.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Event source identifier.
 */
export type EventSource =
  | 'gateway'
  | 'workflow'
  | 'renderer'
  | 'singlefile'
  | 'readability'
  | 'monolith'
  | 'gcs'
  | 'logger'
  | 'cloud-function';

/**
 * Event type for logging.
 */
export type EventType =
  | 'request.created'
  | 'request.done'
  | 'request.failed'
  | 'workflow.started'
  | 'workflow.completed'
  | 'workflow.failed'
  | 'step.started'
  | 'step.completed'
  | 'step.failed'
  | 'artifact.written'
  | 'persist.started'
  | 'persist.completed'
  | 'persist.failed';

/**
 * Log event structure.
 */
export interface LogEvent {
  ts: string;
  source: EventSource;
  type: EventType;
  level: LogLevel;
  message: string;
  attempt?: number;
  data?: Record<string, unknown>;
}

/**
 * Artifact kind (matches @warg/shared).
 */
export type ArtifactKind =
  | 'rendered.html'
  | 'rendered.md'
  | 'screenshot.png'
  | 'page.pdf'
  | 'singlefile.html'
  | 'readability.json'
  | 'readability.md'
  | 'ai-markdown.md'
  | 'monolith.html'
  | 'manifest.json';

/**
 * Artifact info in create-upload request.
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
 * Request body for POST /create-upload.
 */
export interface CreateUploadRequest {
  request_id: string;
  url: string;
  artifacts: ArtifactUploadInfo[];
}

/**
 * Single upload entry in create-upload response.
 */
export interface UploadEntry {
  kind: ArtifactKind;
  signed_url: string;
  gcs_path: string;
  expires_at: string;
}

/**
 * Response body for POST /create-upload.
 */
export interface CreateUploadResponse {
  firestore_doc_id: string;
  uploads: UploadEntry[];
}

/**
 * Single uploaded artifact in finalize request.
 */
export interface UploadedArtifact {
  kind: ArtifactKind;
  gcs_path: string;
  bytes: number;
  sha256: string;
  content_type: string;
  compressed_size: number;
  compression_ratio: number;
}

/**
 * Request body for POST /finalize.
 */
export interface FinalizeRequest {
  request_id: string;
  firestore_doc_id: string;
  uploaded: UploadedArtifact[];
  metadata?: {
    byline: string;
    excerpt: string;
    published_time: string | null;
    site_name: string | null;
    title: string;
    word_count: number;
    lead_image: string | null;
  };
  images?: Array<{ src: string; height?: number; width?: number }>;
}

/**
 * Response body for POST /finalize.
 */
/** The 200 answer of POST /finalize. */
export interface FinalizeResponse {
  success: boolean;
  firestore_doc_id: string;
  status: string;
}

/**
 * The error answers of POST /finalize: 404 `{ error: 'Article not found', firestore_doc_id }`
 * when the shared article does not exist (Firestore NOT_FOUND), and 500
 * `{ error: 'Internal error', message }` for any other failure.
 */
export type FinalizeErrorResponse =
  | { error: 'Article not found'; firestore_doc_id?: string }
  | { error: 'Internal error'; message: string };


/**
 * Mapping from artifact kind to archive key in Firestore.
 * Only artifact kinds that produce archive entries are listed; the
 * "Archive kinds" table of shared-types/WargMetadata.md is the contract.
 * readability.json → metadata (no archive entry)
 * manifest.json → not persisted to GCS
 */
export const KIND_TO_ARCHIVE_KEY: Partial<Record<ArtifactKind, GatewayArchiveKey>> = {
  'singlefile.html': 'singlefile',
  'monolith.html': 'monolith',
  'readability.md': 'readability',
  'ai-markdown.md': 'ai_markdown',
  'rendered.md': 'markdown',
  'page.pdf': 'pdf',
  'screenshot.png': 'screenshot',
  'rendered.html': 'rendered',
};
