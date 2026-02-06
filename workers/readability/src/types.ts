import type { ArtifactMeta } from '@warg/shared';

/**
 * Request body for POST /readability.
 */
export interface ReadabilityRequest {
  request_id: string;
  rendered_html_key: string; // R2 key to fetch HTML from
}

/**
 * Readability extraction result from @mozilla/readability.
 */
export interface ReadabilityResult {
  title: string | null;
  byline: string | null;
  dir: string | null;
  lang: string | null;
  content: string | null;
  textContent: string | null;
  length: number;
  excerpt: string | null;
  siteName: string | null;
  publishedTime: string | null;
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
