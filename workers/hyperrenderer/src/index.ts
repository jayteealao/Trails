import { storeArtifact, timingSafeEqual } from '@warg/shared';
import type { ArtifactMeta } from '@warg/shared';
import { capturePdfViaCdp } from './cdp-pdf.js';
import {
  HyperbrowserApiClient,
  HyperbrowserHttpError,
  HyperbrowserRateLimitError,
} from './hyperbrowser-api.js';
import { decodeBinaryPayload } from './payload-decode.js';
import type {
  HyperbrowserScrapeRequest,
  HyperbrowserStealthMode,
  HyperbrowserWaitUntil,
  HyperbrowserWorkerConfig,
  RenderRateLimitedResponse,
  RenderRequest,
  RenderSuccessResponse,
  RendererOptions,
} from './types.js';

interface BucketObject {
  json<T = unknown>(): Promise<T>;
}

interface ArchiveBucket {
  get(key: string): Promise<BucketObject | null>;
  put(
    key: string,
    value: ArrayBuffer,
    options?: { httpMetadata?: { contentType: string } },
  ): Promise<unknown>;
}

interface Env {
  INTERNAL_API_KEY: string;
  HYPERBROWSER_API_KEY: string;
  HYPERBROWSER_BASE_URL?: string;
  HYPERBROWSER_STEALTH?: string;
  HYPERBROWSER_WAIT_UNTIL?: string;
  HYPERBROWSER_NAV_TIMEOUT_MS?: string;
  HYPERBROWSER_WAIT_FOR_MS?: string;
  HYPERBROWSER_SCRAPE_TIMEOUT_MS?: string;
  HYPERBROWSER_POLL_INTERVAL_MS?: string;
  HYPERBROWSER_PDF_TIMEOUT_MS?: string;
  HYPERBROWSER_SCREENSHOT_FORMAT?: string;
  ARCHIVE_BUCKET: ArchiveBucket;
}

function toInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toWaitUntil(value: string | undefined): HyperbrowserWaitUntil {
  if (value === 'domcontentloaded' || value === 'networkidle' || value === 'load') {
    return value;
  }
  return 'load';
}

function toStealthMode(value: string | undefined): HyperbrowserStealthMode {
  if (value === 'none' || value === 'auto' || value === 'ultra') {
    return value;
  }
  return 'auto';
}

function toScreenshotFormat(value: string | undefined): 'png' | 'jpeg' | 'webp' {
  // Keep renderer compatibility: screenshot artifact is always screenshot.png.
  if (value === 'png') {
    return value;
  }
  return 'png';
}

function getConfig(env: Env): HyperbrowserWorkerConfig {
  return {
    baseUrl: env.HYPERBROWSER_BASE_URL ?? 'https://api.hyperbrowser.ai',
    stealth: toStealthMode(env.HYPERBROWSER_STEALTH),
    waitUntil: toWaitUntil(env.HYPERBROWSER_WAIT_UNTIL),
    navTimeoutMs: toInt(env.HYPERBROWSER_NAV_TIMEOUT_MS, 30000),
    waitForMs: toInt(env.HYPERBROWSER_WAIT_FOR_MS, 0),
    scrapeTimeoutMs: toInt(env.HYPERBROWSER_SCRAPE_TIMEOUT_MS, 90000),
    pollIntervalMs: toInt(env.HYPERBROWSER_POLL_INTERVAL_MS, 2000),
    pdfTimeoutMs: toInt(env.HYPERBROWSER_PDF_TIMEOUT_MS, 45000),
    screenshotFormat: toScreenshotFormat(env.HYPERBROWSER_SCREENSHOT_FORMAT),
  };
}

function buildSessionOptions(stealth: HyperbrowserStealthMode): {
  useStealth?: boolean;
  useUltraStealth?: boolean;
} {
  if (stealth === 'ultra') {
    return { useUltraStealth: true };
  }
  if (stealth === 'auto') {
    return { useStealth: true };
  }
  return {};
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(message: string, maxLength = 240): string {
  if (message.length <= maxLength) return message;
  return `${message.slice(0, maxLength)}...`;
}

async function readRendererOptions(env: Env, optionsKey?: string): Promise<RendererOptions> {
  if (!optionsKey) {
    return { url: '' };
  }

  const object = await env.ARCHIVE_BUCKET.get(optionsKey);
  if (!object) {
    return { url: '' };
  }

  try {
    return (await object.json<RendererOptions>()) ?? { url: '' };
  } catch {
    return { url: '' };
  }
}

async function waitForScrapeResult(
  client: HyperbrowserApiClient,
  jobId: string,
  pollIntervalMs: number,
  timeoutMs: number,
): Promise<{ status: 'completed' | 'failed'; result: Awaited<ReturnType<HyperbrowserApiClient['getScrapeResult']>> }> {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const status = await client.getScrapeStatus(jobId);
    if (status.status === 'completed' || status.status === 'failed') {
      const result = await client.getScrapeResult(jobId);
      return { status: status.status, result };
    }
    await sleep(pollIntervalMs);
  }

  throw new Error(`Timed out waiting for Hyperbrowser scrape job ${jobId}`);
}

function isValidUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const requestUrl = new URL(request.url);
      if (request.method !== 'POST' || requestUrl.pathname !== '/render') {
        return Response.json({ error: 'Not found' }, { status: 404 });
      }

      const apiKey = request.headers.get('X-Internal-API-Key');
      if (!apiKey || !timingSafeEqual(apiKey, env.INTERNAL_API_KEY)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }

      let body: RenderRequest;
      try {
        body = (await request.json()) as RenderRequest;
      } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 });
      }

      const { request_id, url: targetUrl, options_r2_key, browser_quota_kind } = body;
      if (!request_id || !targetUrl || !browser_quota_kind) {
        return Response.json(
          { error: 'Missing required fields: request_id, url, browser_quota_kind' },
          { status: 400 },
        );
      }

      if (!isValidUrl(targetUrl)) {
        return Response.json({ error: 'Invalid url' }, { status: 400 });
      }

      if (!env.HYPERBROWSER_API_KEY) {
        return Response.json({ error: 'Server misconfigured' }, { status: 500 });
      }

      const config = getConfig(env);
      const storedOptions = await readRendererOptions(env, options_r2_key);

      const includeScreenshot = body.include_screenshot ?? storedOptions.includeScreenshot ?? false;
      const includePdf = body.include_pdf ?? storedOptions.includePdf ?? false;
      const includeMarkdown = body.include_markdown ?? false;

      const artifacts: ArtifactMeta[] = [];
      const skipped: string[] = [];
      const totalStart = Date.now();
      const scrapeStart = Date.now();

      const formats: Array<'html' | 'markdown' | 'screenshot'> = ['html'];
      if (includeMarkdown) formats.push('markdown');
      if (includeScreenshot) formats.push('screenshot');

      const scrapeRequest: HyperbrowserScrapeRequest = {
        url: targetUrl,
        sessionOptions: buildSessionOptions(config.stealth),
        scrapeOptions: {
          formats,
          waitUntil: config.waitUntil,
          timeout: config.scrapeTimeoutMs,
          waitFor: config.waitForMs,
          screenshotOptions: includeScreenshot
            ? {
                fullPage: true,
                format: config.screenshotFormat,
              }
            : undefined,
        },
      };

      const client = new HyperbrowserApiClient({
        apiKey: env.HYPERBROWSER_API_KEY,
        baseUrl: config.baseUrl,
        requestTimeoutMs: config.navTimeoutMs,
        retries: 2,
      });

      const startedJob = await client.startScrape(scrapeRequest);
      if (!startedJob.jobId) {
        throw new Error('Hyperbrowser did not return scrape jobId');
      }

      const job = await waitForScrapeResult(
        client,
        startedJob.jobId,
        config.pollIntervalMs,
        config.scrapeTimeoutMs,
      );
      const scrapeMs = Date.now() - scrapeStart;

      if (job.status === 'failed' || job.result.status === 'failed') {
        throw new Error(job.result.error ?? 'Hyperbrowser scrape failed');
      }

      const html = job.result.data?.html;
      if (!html || html.length === 0) {
        throw new Error('Hyperbrowser scrape did not return HTML');
      }

      const htmlData = new TextEncoder().encode(html);
      const htmlMeta = await storeArtifact(
        env.ARCHIVE_BUCKET,
        request_id,
        'rendered.html',
        htmlData.buffer as ArrayBuffer,
        'text/html',
      );
      artifacts.push(htmlMeta);

      if (includeScreenshot) {
        const screenshotPayload = job.result.data?.screenshot;
        if (!screenshotPayload) {
          skipped.push('screenshot: not returned by Hyperbrowser');
        } else {
          try {
            const decoded = await decodeBinaryPayload(screenshotPayload);
            const screenshotMeta = await storeArtifact(
              env.ARCHIVE_BUCKET,
              request_id,
              'screenshot.png',
              decoded.data,
              decoded.contentType.startsWith('image/') ? decoded.contentType : 'image/png',
            );
            artifacts.push(screenshotMeta);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            skipped.push(`screenshot: ${truncate(message)}`);
          }
        }
      } else {
        skipped.push('screenshot: not requested');
      }

      if (includeMarkdown) {
        const markdown = job.result.data?.markdown;
        if (!markdown) {
          skipped.push('markdown: not returned by Hyperbrowser');
        } else {
          const markdownData = new TextEncoder().encode(markdown);
          const markdownMeta = await storeArtifact(
            env.ARCHIVE_BUCKET,
            request_id,
            'rendered.md',
            markdownData.buffer as ArrayBuffer,
            'text/markdown',
          );
          artifacts.push(markdownMeta);
        }
      } else {
        skipped.push('markdown: not requested');
      }

      let pdfMs: number | undefined;
      if (includePdf) {
        const pdfStart = Date.now();
        let sessionId: string | undefined;

        try {
          const session = await client.createSession({
            ...buildSessionOptions(config.stealth),
            timeoutMinutes: Math.max(Math.ceil(config.pdfTimeoutMs / 60000), 1),
          });

          sessionId = session.id;
          if (!session.wsEndpoint) {
            throw new Error('Hyperbrowser session did not include wsEndpoint');
          }

          const pdfBytes = await capturePdfViaCdp({
            wsEndpoint: session.wsEndpoint,
            targetUrl,
            waitUntil: config.waitUntil,
            navigationTimeoutMs: config.pdfTimeoutMs,
            commandTimeoutMs: config.pdfTimeoutMs,
          });

          const pdfMeta = await storeArtifact(
            env.ARCHIVE_BUCKET,
            request_id,
            'page.pdf',
            pdfBytes,
            'application/pdf',
          );
          artifacts.push(pdfMeta);
        } catch (error) {
          if (error instanceof HyperbrowserRateLimitError) {
            throw error;
          }
          const message = error instanceof Error ? error.message : String(error);
          skipped.push(`pdf: ${truncate(message)}`);
        } finally {
          if (sessionId) {
            try {
              await client.stopSession(sessionId);
            } catch (error) {
              console.warn('[hyperrenderer] Failed to stop Hyperbrowser session', {
                sessionId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
          pdfMs = Date.now() - pdfStart;
        }
      } else {
        skipped.push('pdf: not requested');
      }

      const response: RenderSuccessResponse = {
        uses_browser_rendering: true,
        quota_kind_used: browser_quota_kind,
        artifacts,
        meta: {
          skipped,
          browserApiMs: Date.now() - totalStart,
          provider: 'hyperbrowser',
          hyperbrowserJobId: startedJob.jobId,
          hyperbrowserScrapeMs: scrapeMs,
          hyperbrowserPdfMs: pdfMs,
        },
      };

      return Response.json(response);
    } catch (error) {
      if (error instanceof HyperbrowserRateLimitError) {
        const rateLimited: RenderRateLimitedResponse = {
          error: 'rate_limited',
          retry_after_ms: error.retryAfterMs,
          message: error.message,
        };
        return Response.json(rateLimited, { status: 429 });
      }

      if (error instanceof HyperbrowserHttpError) {
        return Response.json(
          {
            error: 'Hyperbrowser request failed',
            status: error.status,
            details: error.body || error.message,
          },
          { status: 502 },
        );
      }

      const message = error instanceof Error ? error.message : String(error);
      console.error('[hyperrenderer] Unhandled error:', message);
      return Response.json({ error: 'Internal error', message }, { status: 500 });
    }
  },
};
