import type { ArtifactMeta } from '@warg/shared/types';

/**
 * Request body for POST /singlefile.
 */
export interface SinglefileRequest {
  request_id: string;
  url: string;
  options_r2_key?: string;
}

/**
 * Options for SingleFile capture.
 */
export interface SinglefileOptions {
  /** Custom cleanup script to run before capture */
  cleanupScript?: string;
  /** Scroll to bottom to trigger lazy-loaded content (default: true) */
  scrollToBottom?: boolean;
  /** Navigation wait condition */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
  /** Navigation timeout in ms (default: 30000) */
  timeout?: number;
  /** Compress HTML content */
  compressContent?: boolean;
  /** Block scripts in output */
  blockScripts?: boolean;
  /** Block images in output */
  blockImages?: boolean;
  /** Block videos in output */
  blockVideos?: boolean;
}

/**
 * Successful response from singlefile worker.
 */
export interface SinglefileSuccessResponse {
  artifact: ArtifactMeta;
}

/**
 * Rate limited response from singlefile worker.
 */
export interface SinglefileRateLimitedResponse {
  error: 'rate_limited';
  retry_after_ms: number;
  message: string;
}

/**
 * Union of possible singlefile responses.
 */
export type SinglefileResponse = SinglefileSuccessResponse | SinglefileRateLimitedResponse;
