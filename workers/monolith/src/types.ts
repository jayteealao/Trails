import type { ArtifactMeta } from '@warg/shared/types';

/**
 * Request body for POST /monolith.
 */
export interface MonolithRequest {
  request_id: string;
  rendered_html_key: string; // R2 key to fetch HTML from
  base_url: string; // Base URL for resolving relative links
}

/**
 * Successful response from monolith worker.
 */
export interface MonolithSuccessResponse {
  artifact: ArtifactMeta;
  meta?: {
    method: 'sandbox' | 'http_fallback';
    processingMs?: number;
  };
}
