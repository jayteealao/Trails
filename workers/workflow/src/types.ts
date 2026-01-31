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
 */
export interface RendererResponse {
  artifacts: ArtifactMeta[];
}

/**
 * Response from derivative services (singlefile, monolith).
 */
export interface DerivativeResponse {
  artifact: ArtifactMeta;
}

/**
 * Response from the readability service.
 */
export interface ReadabilityResponse {
  json: ArtifactMeta;
  md: ArtifactMeta;
}

/**
 * Response from the GCS persistence service.
 */
export interface GcsResponse {
  gcsKeys: Record<ArtifactKind, string>;
  firestoreDocId: string;
}

/**
 * Parameters for calling the renderer service.
 */
export interface RendererParams {
  request_id: string;
  url: string;
  includeScreenshot?: boolean;
  includePdf?: boolean;
}

/**
 * Parameters for calling derivative services.
 */
export interface DerivativeParams {
  request_id: string;
  rendered_html_key: string;
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
