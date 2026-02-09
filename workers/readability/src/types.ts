import type { ArtifactMeta, ReadabilityResult } from '@warg/shared';

export type { ReadabilityResult };

/**
 * Request body for POST /readability.
 */
export interface ReadabilityRequest {
  request_id: string;
  rendered_html_key: string; // R2 key to fetch HTML from
}

/**
 * Successful response from readability worker.
 */
export interface ReadabilitySuccessResponse {
  json: ArtifactMeta;
  md: ArtifactMeta;
  meta?: {
    title: string | null;
    byline: string | null;
    textLength: number;
    excerptLength: number;
  };
}
