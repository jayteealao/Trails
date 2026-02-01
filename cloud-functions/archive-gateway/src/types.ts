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
}

/**
 * Request body for POST /finalize.
 */
export interface FinalizeRequest {
  request_id: string;
  firestore_doc_id: string;
  uploaded: UploadedArtifact[];
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
 */
export interface ArchiveEntry {
  status: 'pending' | 'success' | 'failed';
  gcs_path?: string;
  gcs_bucket?: string;
  file_size?: number;
  sha256?: string;
  content_type?: string;
}

/**
 * Firestore document structure for articles collection.
 */
export interface ArticleDocument {
  item_id: string;
  url: string;
  domain: string;
  title?: string;
  created_at: FirebaseFirestore.Timestamp;
  updated_at: FirebaseFirestore.Timestamp;
  archives: Record<string, ArchiveEntry>;
  metadata?: {
    title?: string;
    byline?: string;
    excerpt?: string;
    siteName?: string;
    wordCount?: number;
  };
}

/**
 * Mapping from artifact kind to archive key in Firestore.
 */
export const KIND_TO_ARCHIVE_KEY: Record<ArtifactKind, string> = {
  'singlefile.html': 'singlefile',
  'monolith.html': 'monolith',
  'readability.json': 'readability_json',
  'readability.md': 'readability_md',
  'page.pdf': 'pdf',
  'screenshot.png': 'screenshot',
  'rendered.html': 'rendered',
  'rendered.md': 'rendered_md',
  'manifest.json': 'manifest'
};

/**
 * GCS path pattern configuration.
 */
export const GCS_PATH_CONFIG: Record<ArtifactKind, { folder: string; filename: string }> = {
  'singlefile.html': { folder: 'singlefile', filename: 'output.html' },
  'monolith.html': { folder: 'monolith', filename: 'output.html' },
  'readability.json': { folder: 'readability', filename: 'output.json' },
  'readability.md': { folder: 'readability', filename: 'output.md' },
  'page.pdf': { folder: 'pdf', filename: 'output.pdf' },
  'screenshot.png': { folder: 'screenshot', filename: 'output.png' },
  'rendered.html': { folder: 'rendered', filename: 'output.html' },
  'rendered.md': { folder: 'rendered', filename: 'output.md' },
  'manifest.json': { folder: 'manifest', filename: 'manifest.json' }
};
