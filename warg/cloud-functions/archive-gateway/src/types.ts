// GCS worker contract — keep in sync with workers/gcs/src/types.ts

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
  };
  images?: Array<{ src: string; height?: number; width?: number }>;
}

/**
 * Response body for POST /finalize.
 */
export interface FinalizeResponse {
  success: boolean;
  firestore_doc_id: string;
  status: string;
}

/**
 * Archive entry in Firestore document.
 *
 * Lifecycle:
 *   uploading → success    (happy path, finalized after GCS upload)
 *   uploading → failed     (the upload itself errored)
 *   uploading → <stuck>    (worker died; reconcile-archives-map.mjs promotes
 *                           from GCS truth if bytes are present)
 *
 * `pending` is retained for backward-compat with older docs written before
 * the journal-then-act change landed.
 */
export interface ArchiveEntry {
  status: 'pending' | 'uploading' | 'success' | 'failed';
  gcs_path?: string;
  gcs_bucket?: string;
  compressed_size?: number;
  compression_ratio?: number;
  started_at?: string;
  created_at?: string;
}

/**
 * Firestore document structure for articles collection.
 */
export interface ArticleDocument {
  item_id: string;
  url: string;
  domain: string;
  created_at: FirebaseFirestore.Timestamp;
  updated_at: FirebaseFirestore.Timestamp;
  pocket: {
    favorite: string;
    resolved_id: string;
    status: string;
    time_added: number;
    time_read: number;
  };
  metadata: {
    byline: string;
    excerpt: string;
    published_time: string | null;
    site_name: string | null;
    title: string;
    word_count: number;
  };
  archives: Record<string, ArchiveEntry>;
  stats: {
    last_accessed: string;
    total_saves: number;
    total_views: number;
  };
  images: Array<{ src: string; height?: number; width?: number }>;
}

/**
 * Mapping from artifact kind to archive key in Firestore.
 * Only artifact kinds that produce archive entries are listed.
 * readability.json → metadata (no archive entry)
 * manifest.json → not persisted to GCS
 */
export const KIND_TO_ARCHIVE_KEY: Partial<Record<ArtifactKind, string>> = {
  'singlefile.html': 'singlefile',
  'monolith.html': 'monolith',
  'readability.md': 'readability',
  'rendered.md': 'markdown',
  'page.pdf': 'pdf',
  'screenshot.png': 'screenshot',
  'rendered.html': 'rendered',
};

/**
 * GCS path pattern configuration.
 */
export const GCS_PATH_CONFIG: Record<ArtifactKind, { folder: string; filename: string }> = {
  'singlefile.html': { folder: 'singlefile', filename: 'output.html.gz' },
  'monolith.html': { folder: 'monolith', filename: 'output.html.gz' },
  'readability.json': { folder: 'readability', filename: 'output.json' },
  'readability.md': { folder: 'readability', filename: 'output.md.gz' },
  'page.pdf': { folder: 'pdf', filename: 'output.pdf' },
  'screenshot.png': { folder: 'screenshot', filename: 'output.png' },
  'rendered.html': { folder: 'rendered', filename: 'output.html.gz' },
  'rendered.md': { folder: 'rendered', filename: 'output.md.gz' },
  'manifest.json': { folder: 'manifest', filename: 'manifest.json' }
};
