import type { ArtifactMeta } from '@warg/shared/types';

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
 * Union of possible renderer responses.
 */
export type RenderResponse = RenderSuccessResponse | RenderRateLimitedResponse;

/**
 * Extended archive options with preScript support.
 */
export interface RendererOptions {
  url: string;
  includeScreenshot?: boolean;
  includePdf?: boolean;
  preScript?: string;
}
