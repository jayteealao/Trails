import type { ArtifactMeta } from '@warg/shared';

export type BrowserQuotaKind = 'bindings_launch' | 'rest_request';

export interface RenderRequest {
  request_id: string;
  url: string;
  options_r2_key?: string;
  browser_quota_kind: BrowserQuotaKind;
  include_screenshot?: boolean;
  include_pdf?: boolean;
  include_markdown?: boolean;
}

export interface RenderSuccessResponse {
  uses_browser_rendering: true;
  quota_kind_used: BrowserQuotaKind;
  artifacts: ArtifactMeta[];
  meta?: {
    skipped: string[];
    browserApiMs?: number;
    provider?: 'hyperbrowser';
    hyperbrowserJobId?: string;
    hyperbrowserScrapeMs?: number;
    hyperbrowserPdfMs?: number;
  };
}

export interface RenderRateLimitedResponse {
  error: 'rate_limited';
  retry_after_ms: number;
  message: string;
}

export interface RendererOptions {
  url: string;
  includeScreenshot?: boolean;
  includePdf?: boolean;
}

export type HyperbrowserStealthMode = 'none' | 'auto' | 'ultra';
export type HyperbrowserWaitUntil = 'load' | 'domcontentloaded' | 'networkidle';
export type HyperbrowserScreenshotFormat = 'png' | 'jpeg' | 'webp';
export type HyperbrowserScrapeStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface HyperbrowserScrapeRequest {
  url: string;
  sessionOptions?: {
    useStealth?: boolean;
    useUltraStealth?: boolean;
  };
  scrapeOptions?: {
    formats: Array<'html' | 'markdown' | 'screenshot'>;
    waitUntil?: HyperbrowserWaitUntil;
    timeout?: number;
    waitFor?: number;
    screenshotOptions?: {
      fullPage?: boolean;
      format?: HyperbrowserScreenshotFormat;
    };
  };
}

export interface HyperbrowserScrapeStartResponse {
  jobId: string;
}

export interface HyperbrowserScrapeStatusResponse {
  status: HyperbrowserScrapeStatus;
}

export interface HyperbrowserScrapeResultResponse {
  jobId: string;
  status: HyperbrowserScrapeStatus;
  error?: string;
  data?: {
    html?: string;
    markdown?: string;
    screenshot?: string;
    metadata?: Record<string, string | string[]>;
    links?: string[];
  };
}

export interface HyperbrowserSessionOptions {
  useStealth?: boolean;
  useUltraStealth?: boolean;
  timeoutMinutes?: number;
}

export interface HyperbrowserSessionDetail {
  id: string;
  wsEndpoint: string;
}

export interface HyperbrowserBasicResponse {
  success?: boolean;
  message?: string;
}

export interface HyperbrowserClientConfig {
  apiKey: string;
  baseUrl: string;
  requestTimeoutMs: number;
  retries: number;
}

export interface HyperbrowserWorkerConfig {
  baseUrl: string;
  stealth: HyperbrowserStealthMode;
  waitUntil: HyperbrowserWaitUntil;
  navTimeoutMs: number;
  waitForMs: number;
  scrapeTimeoutMs: number;
  pollIntervalMs: number;
  pdfTimeoutMs: number;
  screenshotFormat: HyperbrowserScreenshotFormat;
}

export interface CdpEventMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
  sessionId?: string;
}
