import {
  accessBlockedResponse,
  decodeBase64ToArrayBuffer,
  isChallengePage,
  isProxyErrorPage,
  PROXY_ERROR_PAGE_REASON,
  storeArtifact,
  timingSafeEqual
} from '@warg/shared';
import type { ArtifactMeta } from '@warg/shared';
import type {
  RenderRequest,
  RenderSuccessResponse,
  RenderRateLimitedResponse,
  RendererOptions
} from './types.js';

const GOTO_OPTIONS = { waitUntil: 'load', timeout: 30000 } as const;

/**
 * One page load for the HTML and every other requested format. A snapshot needs
 * at least two formats, so an HTML-only render uses the content action instead.
 */
function loadPage(env: Env, url: string, formats: BrowserRunSnapshotFormat[]): Promise<Response> {
  if (formats.length >= 2) {
    return env.BROWSER.quickAction('snapshot', { url, formats, gotoOptions: GOTO_OPTIONS });
  }
  return env.BROWSER.quickAction('content', { url, gotoOptions: GOTO_OPTIONS });
}

interface LoadedPage {
  html: string;
  screenshot?: string;
  markdown?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Reads a content or snapshot success answer; undefined when it carries no HTML. */
function parseLoadedPage(json: unknown): LoadedPage | undefined {
  if (!isRecord(json) || json.success !== true) return undefined;
  const { result } = json;
  if (typeof result === 'string') return result ? { html: result } : undefined;
  if (!isRecord(result)) return undefined;
  const html = optionalString(result.content);
  if (!html) return undefined;
  return { html, screenshot: optionalString(result.screenshot), markdown: optionalString(result.markdown) };
}

/** Screenshot bytes from base64 text, with or without a data-URI prefix. */
function decodeScreenshot(screenshot: string): ArrayBuffer {
  return decodeBase64ToArrayBuffer(screenshot.replace(/^data:[^,]*;base64,/i, ''));
}

/**
 * Check if a Browser Rendering response is rate-limited.
 * Returns a 429 Response if so, or null to continue.
 */
function checkRateLimit(resp: Response, context: string): Response | null {
  if (resp.status !== 429) return null;
  const retryAfter = resp.headers.get('Retry-After');
  const retryMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
  const rateLimited: RenderRateLimitedResponse = {
    error: 'rate_limited',
    retry_after_ms: retryMs,
    message: `Browser Rendering rate limited${context ? ` on ${context}` : ''}`
  };
  return Response.json(rateLimited, { status: 429 });
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    try {
      // Only accept POST /render
      const url = new URL(request.url);
      if (request.method !== 'POST' || url.pathname !== '/render') {
        return Response.json({ error: 'Not found' }, { status: 404 });
      }

      // Verify internal API key
      const apiKey = request.headers.get('X-Internal-API-Key');
      if (!apiKey || !timingSafeEqual(apiKey, env.INTERNAL_API_KEY)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }

      // Parse request body
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
          { status: 400 }
        );
      }

      // Read options from R2 if provided
      let options: RendererOptions = { url: targetUrl };
      if (options_r2_key) {
        const obj = await env.ARCHIVE_BUCKET.get(options_r2_key);
        if (obj) {
          try {
            options = (await obj.json()) as RendererOptions;
          } catch {
            // Fall back to defaults if options can't be parsed
          }
        }
      }

      // Merge request flags with R2 options (request flags take precedence)
      const includeScreenshot = body.include_screenshot ?? options.includeScreenshot ?? false;
      const includePdf = body.include_pdf ?? options.includePdf ?? false;
      const includeMarkdown = body.include_markdown ?? false;

      const formats: BrowserRunSnapshotFormat[] = [
        'content',
        ...(includeScreenshot ? (['screenshot'] as const) : []),
        ...(includeMarkdown ? (['markdown'] as const) : [])
      ];
      const artifacts: ArtifactMeta[] = [];
      const skipped: string[] = [];
      const browserApiStart = Date.now();

      // 1. One page load: the HTML, plus the screenshot and Markdown when requested
      const pageResp = await loadPage(env, targetUrl, formats);
      const pageRateLimit = checkRateLimit(pageResp, '');
      if (pageRateLimit) return pageRateLimit;
      if (!pageResp.ok) {
        const errorText = await pageResp.text();
        // Stays 502: a 401/403 from this worker would read as a blocked target page.
        return Response.json(
          {
            error: 'Browser Rendering /content failed',
            status: pageResp.status,
            details: errorText
          },
          { status: 502 }
        );
      }
      const page = parseLoadedPage(await pageResp.json());
      if (!page) {
        return Response.json(
          { error: 'Browser Rendering /content returned invalid response' },
          { status: 502 }
        );
      }
      if (isProxyErrorPage(page.html)) {
        return Response.json(
          {
            error: 'Browser Rendering /content returned a proxy/network error page',
            reason: PROXY_ERROR_PAGE_REASON,
            url: targetUrl
          },
          { status: 502 }
        );
      }
      if (isChallengePage(page.html)) {
        console.warn('[renderer] Browser Rendering /content returned a challenge page:', targetUrl);
        return accessBlockedResponse(targetUrl);
      }
      const htmlData = new TextEncoder().encode(page.html);
      const htmlMeta = await storeArtifact(
        env.ARCHIVE_BUCKET,
        request_id,
        'rendered.html',
        htmlData.buffer as ArrayBuffer,
        'text/html'
      );
      artifacts.push(htmlMeta);

      // 2. Screenshot from the same load
      if (!includeScreenshot) {
        skipped.push('screenshot: not requested');
      } else if (page.screenshot) {
        const ssMeta = await storeArtifact(
          env.ARCHIVE_BUCKET,
          request_id,
          'screenshot.png',
          decodeScreenshot(page.screenshot),
          'image/png'
        );
        artifacts.push(ssMeta);
      } else {
        skipped.push('screenshot: snapshot returned no screenshot');
      }

      // 3. PDF, when requested, takes its own load
      if (includePdf) {
        const pdfResp = await env.BROWSER.quickAction('pdf', { url: targetUrl, gotoOptions: GOTO_OPTIONS });
        const pdfRateLimit = checkRateLimit(pdfResp, 'PDF');
        if (pdfRateLimit) return pdfRateLimit;
        if (pdfResp.ok) {
          const pdfData = await pdfResp.arrayBuffer();
          const pdfMeta = await storeArtifact(env.ARCHIVE_BUCKET, request_id, 'page.pdf', pdfData, 'application/pdf');
          artifacts.push(pdfMeta);
        } else {
          skipped.push(`pdf: API returned ${pdfResp.status}`);
        }
      } else {
        skipped.push('pdf: not requested');
      }

      // 4. Markdown from the same load
      if (!includeMarkdown) {
        skipped.push('markdown: not requested');
      } else if (page.markdown) {
        const mdData = new TextEncoder().encode(page.markdown);
        const mdMeta = await storeArtifact(
          env.ARCHIVE_BUCKET,
          request_id,
          'rendered.md',
          mdData.buffer as ArrayBuffer,
          'text/markdown'
        );
        artifacts.push(mdMeta);
      } else {
        skipped.push('markdown: snapshot returned no markdown');
      }

      const browserApiMs = Date.now() - browserApiStart;
      const successResponse: RenderSuccessResponse = {
        uses_browser_rendering: true,
        quota_kind_used: browser_quota_kind,
        artifacts,
        meta: { skipped, browserApiMs }
      };
      return Response.json(successResponse);
    } catch (err) {
      console.error('[renderer] Unhandled error:', err);
      const errMsg = err instanceof Error ? err.message : String(err);
      return Response.json({ error: 'Internal error', message: errMsg }, { status: 500 });
    }
  }
};
