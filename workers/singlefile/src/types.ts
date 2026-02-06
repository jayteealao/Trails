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
 *
 * These options are divided into:
 * - Pre-capture (Puppeteer-level): cleanupScript, scrollToBottom, waitUntil, timeout
 * - SingleFile native: passed directly to singlefile.getPageData()
 */
export interface SinglefileOptions {
  // --- Pre-capture (Puppeteer-level) options ---

  /** Custom cleanup script to run before capture (removes modals, banners, etc.) */
  cleanupScript?: string;
  /** Scroll to bottom to trigger lazy-loaded content (default: true) */
  scrollToBottom?: boolean;
  /** Navigation wait condition */
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
  /** Navigation timeout in ms (default: 60000) */
  timeout?: number;

  // --- SingleFile native options ---

  /** Remove hidden elements from output (default: true) */
  removeHiddenElements?: boolean;
  /** Remove unused CSS styles (default: true) */
  removeUnusedStyles?: boolean;
  /** Remove unused fonts (default: true) */
  removeUnusedFonts?: boolean;
  /** Compress/minify HTML output (default: true) */
  compressHTML?: boolean;
  /** Block/remove scripts from output (default: true) */
  blockScripts?: boolean;
  /** Block/remove videos from output (default: true) */
  blockVideos?: boolean;
  /** Block/remove audio elements from output (default: true) */
  blockAudios?: boolean;
  /** Remove iframes from output (default: false) */
  removeFrames?: boolean;
  /** Remove alternative images (srcset) (default: false) */
  removeAlternativeImages?: boolean;

  // --- Deprecated/mapped options (kept for backward compat) ---

  /** @deprecated Use compressHTML instead */
  compressContent?: boolean;
  /** @deprecated Use removeAlternativeImages instead */
  blockImages?: boolean;
}

/**
 * SingleFile native options passed directly to singlefile.getPageData().
 */
export interface SinglefileNativeOptions {
  removeHiddenElements?: boolean;
  removeUnusedStyles?: boolean;
  removeUnusedFonts?: boolean;
  compressHTML?: boolean;
  blockScripts?: boolean;
  blockVideos?: boolean;
  blockAudios?: boolean;
  removeFrames?: boolean;
  removeAlternativeImages?: boolean;
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
