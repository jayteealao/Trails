import type { ArchiveOptions, ArtifactMeta, ArtifactKind } from '@warg/shared';

/**
 * Parameters passed to the workflow when starting it.
 */
export interface WorkflowParams {
  request_id: string;
  url: string;
  options_r2_key: string;
}

/**
 * Extended archive options with workflow-specific fields.
 */
export interface ArchiveOptionsExtended extends ArchiveOptions {
  dryRun?: boolean;
}

/**
 * Response from the renderer service.
 * Matches RenderSuccessResponse from workers/renderer/src/types.ts.
 */
export interface RendererResponse {
  uses_browser_rendering: true;
  quota_kind_used: 'bindings_launch' | 'rest_request';
  artifacts: ArtifactMeta[];
  meta?: {
    skipped: string[];
    browserApiMs?: number;
  };
}

/**
 * Response from derivative services (singlefile, monolith).
 */
export interface DerivativeResponse {
  artifact: ArtifactMeta;
  meta?: {
    method?: 'sandbox' | 'http_fallback';
    processingMs?: number;
  };
}

/**
 * Response from the readability service.
 */
export interface ReadabilityResponse {
  json: ArtifactMeta;
  md: ArtifactMeta;
  meta?: {
    title: string | null;
    byline: string | null;
    textLength: number;
    excerptLength: number;
  };
}

/**
 * Response from the GCS persistence service.
 * Matches PersistResponse from workers/gcs/src/types.ts (snake_case convention).
 */
export interface GcsResponse {
  success: boolean;
  firestore_doc_id: string;
  uploaded: number;
  artifacts: Array<{ kind: ArtifactKind; gcs_path: string }>;
  meta?: {
    compressionStats: Array<{
      kind: string;
      originalBytes: number;
      compressedBytes: number;
      ratio: number;
    }>;
    uploadDurationMs: number;
    skippedArtifacts: string[];
  };
}

/**
 * Parameters for calling the renderer service.
 * Matches RenderRequest from workers/renderer/src/types.ts (snake_case convention).
 */
export interface RendererParams {
  request_id: string;
  url: string;
  browser_quota_kind: 'bindings_launch' | 'rest_request';
  options_r2_key?: string;
  include_screenshot?: boolean;
  include_pdf?: boolean;
  include_markdown?: boolean;
}

/**
 * Parameters for calling readability service.
 */
export interface DerivativeParams {
  request_id: string;
  rendered_html_key: string;
}

/**
 * Parameters for calling the monolith service.
 * Monolith requires base_url for resolving relative links.
 */
export interface MonolithParams {
  request_id: string;
  rendered_html_key: string;
  base_url: string;
}

/**
 * Parameters for calling the singlefile service.
 * SingleFile requires a live URL (not rendered HTML) because it navigates
 * to the page and injects scripts to capture resources.
 */
export interface SinglefileParams {
  request_id: string;
  url: string;
  options_r2_key?: string;
}

/**
 * Parameters for calling the GCS persistence service.
 */
export interface GcsParams {
  request_id: string;
  manifest_key: string;
}

/**
 * Workflow step result for render phase.
 */
export interface RenderStepResult {
  artifacts: ArtifactMeta[];
  renderedHtmlKey: string;
}

/**
 * Workflow step result for derivative phase.
 */
export interface DerivativeStepResults {
  singlefile?: ArtifactMeta;
  readabilityJson?: ArtifactMeta;
  readabilityMd?: ArtifactMeta;
  monolith?: ArtifactMeta;
}

/**
 * Final workflow result.
 */
export interface WorkflowResult {
  status: 'done';
  manifestKey: string;
  dryRun?: boolean;
  mock?: boolean;
  gcsResult?: GcsResponse;
}
