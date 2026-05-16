import type { ArtifactMeta } from '@warg/shared';

/**
 * Browser Rendering quota kind.
 */
export type BrowserQuotaKind = 'bindings_launch' | 'rest_request';

/**
 * Request body for POST /render.
 */
export interface RenderRequest {
  request_id: string;
  url: string;
  options_r2_key?: string;
  browser_quota_kind: BrowserQuotaKind;
  include_screenshot?: boolean;
  include_pdf?: boolean;
  include_markdown?: boolean;
}

/**
 * Successful response from renderer.
 */
export interface RenderSuccessResponse {
  uses_browser_rendering: true;
  quota_kind_used: BrowserQuotaKind;
  artifacts: ArtifactMeta[];
  meta?: {
    skipped: string[];
    browserApiMs?: number;
  };
}

/**
 * Rate limited response from renderer.
 */
export interface RenderRateLimitedResponse {
  error: 'rate_limited';
  retry_after_ms: number;
  message: string;
}

/**
 * Extended archive options for renderer.
 */
export interface RendererOptions {
  url: string;
  includeScreenshot?: boolean;
  includePdf?: boolean;
}
