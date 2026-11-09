import { PROXY_ERROR_PAGE_REASON, proxyErrorPageText, storeArtifact, timingSafeEqual } from '@warg/shared';
import type { ArtifactMeta } from '@warg/shared';
import type {
  RenderRequest,
  RenderSuccessResponse,
  RenderRateLimitedResponse,
  RendererOptions
} from './types.js';

const GOTO_OPTIONS = { waitUntil: 'load', timeout: 30000 } as const;

/** The formats one page load returns: always the HTML, plus the requested screenshot and markdown. */
function planFormats(flags: { includeScreenshot: boolean; includeMarkdown: boolean }): BrowserRunSnapshotFormat[] {
  return [
    'content',
    ...(flags.includeScreenshot ? (['screenshot'] as const) : []),
    ...(flags.includeMarkdown ? (['markdown'] as const) : [])
  ];
}

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

/** Screenshot bytes from base64 text, with or without a data-URI prefix; undefined when the text is not base64. */
function decodeScreenshot(screenshot: string): ArrayBuffer | undefined {
  try {
    const binary = atob(screenshot.replace(/^data:[^,]*;base64,/i, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  } catch (err) {
    console.error('[renderer] snapshot screenshot is not valid base64:', err instanceof Error ? err.message : String(err));
    return undefined;
  }
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

      const browserApiStart = Date.now();
      const formats = planFormats({ includeScreenshot, includeMarkdown });
      let action: 'snapshot' | 'content' = formats.length >= 2 ? 'snapshot' : 'content';

      // 1. One page load for the HTML and the requested screenshot and markdown
      let pageResp: Response | undefined;
      let snapshotFailure: string | undefined;
      try {
        pageResp = await loadPage(env, targetUrl, formats);
      } catch (err) {
        // A content load that throws has no HTML to keep: the outer handler answers 500.
        if (action !== 'snapshot') throw err;
        snapshotFailure = err instanceof Error ? err.message : String(err);
      }
      if (pageResp) {
        const pageRateLimit = checkRateLimit(pageResp, '');
        if (pageRateLimit) return pageRateLimit;
        // A 403 is the target blocking access: answer it at once so the workflow's fallback sees it.
        if (!pageResp.ok && action === 'snapshot' && pageResp.status !== 403) {
          snapshotFailure = String(pageResp.status);
          await pageResp.body?.cancel();
          pageResp = undefined;
        }
      }
      if (!pageResp) {
        // A failed snapshot must not lose the HTML: load the HTML alone once, and skip the other formats.
        console.error(
          '[renderer] snapshot load failed, retrying the HTML alone',
          JSON.stringify({ request_id, formats, failure: snapshotFailure })
        );
        action = 'content';
        pageResp = await loadPage(env, targetUrl, ['content']);
        const retryRateLimit = checkRateLimit(pageResp, '');
        if (retryRateLimit) return retryRateLimit;
      }
      if (!pageResp.ok) {
        const errorText = await pageResp.text();
        console.error('[renderer] page load failed', JSON.stringify({ request_id, action, status: pageResp.status }));
        // The error text is a contract with the workflow's renderer fallback (workflow services.ts)
        // and covers content and snapshot loads alike: change both sides together.
        return Response.json(
          { error: 'Browser Rendering /content failed', status: pageResp.status, details: errorText },
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
      const proxyErrorText = proxyErrorPageText(page.html);
      if (proxyErrorText !== undefined) {
        return Response.json(
          {
            error: 'Browser Rendering /content returned a proxy/network error page',
            reason: PROXY_ERROR_PAGE_REASON,
            detail: proxyErrorText,
            url: targetUrl
          },
          { status: 502 }
        );
      }

      // 2. Store what the page load returned: the HTML first, then the screenshot and markdown
      const htmlData = new TextEncoder().encode(page.html);
      const htmlMeta = await storeArtifact(
        env.ARCHIVE_BUCKET,
        request_id,
        'rendered.html',
        htmlData.buffer as ArrayBuffer,
        'text/html'
      );

      let screenshotMeta: ArtifactMeta | undefined;
      let screenshotSkip = 'screenshot: not requested';
      if (includeScreenshot) {
        const screenshotData = page.screenshot ? decodeScreenshot(page.screenshot) : undefined;
        if (screenshotData) {
          screenshotMeta = await storeArtifact(env.ARCHIVE_BUCKET, request_id, 'screenshot.png', screenshotData, 'image/png');
        } else {
          screenshotSkip = snapshotFailure
            ? `screenshot: snapshot failed with ${snapshotFailure}`
            : page.screenshot
              ? 'screenshot: snapshot screenshot is not valid base64'
              : 'screenshot: snapshot returned no screenshot';
        }
      }

      let markdownMeta: ArtifactMeta | undefined;
      let markdownSkip = 'markdown: not requested';
      if (includeMarkdown) {
        if (page.markdown) {
          const mdData = new TextEncoder().encode(page.markdown);
          markdownMeta = await storeArtifact(
            env.ARCHIVE_BUCKET,
            request_id,
            'rendered.md',
            mdData.buffer as ArrayBuffer,
            'text/markdown'
          );
        } else {
          markdownSkip = snapshotFailure
            ? `markdown: snapshot failed with ${snapshotFailure}`
            : 'markdown: snapshot returned no markdown';
        }
      }

      // 3. The PDF, when requested, takes its own load: a snapshot cannot return one
      let pdfMeta: ArtifactMeta | undefined;
      let pdfSkip = 'pdf: not requested';
      if (includePdf) {
        let pdfResp: Response | undefined;
        try {
          pdfResp = await env.BROWSER.quickAction('pdf', { url: targetUrl, gotoOptions: GOTO_OPTIONS });
        } catch (err) {
          // The PDF is optional: a thrown load becomes a skip note and keeps the stored artifacts.
          const message = err instanceof Error ? err.message : String(err);
          console.error('[renderer] pdf load failed', JSON.stringify({ request_id, failure: message }));
          pdfSkip = `pdf: ${message}`;
        }
        if (pdfResp) {
          const pdfRateLimit = checkRateLimit(pdfResp, 'PDF');
          if (pdfRateLimit) return pdfRateLimit;
          if (pdfResp.ok) {
            const pdfData = await pdfResp.arrayBuffer();
            pdfMeta = await storeArtifact(env.ARCHIVE_BUCKET, request_id, 'page.pdf', pdfData, 'application/pdf');
          } else {
            pdfSkip = `pdf: API returned ${pdfResp.status}`;
          }
        }
      }

      // 4. The answer lists the artifacts and skip notes in a fixed order: html, screenshot, pdf, markdown
      const artifacts: ArtifactMeta[] = [htmlMeta];
      const skipped: string[] = [];
      for (const [meta, skip] of [
        [screenshotMeta, screenshotSkip],
        [pdfMeta, pdfSkip],
        [markdownMeta, markdownSkip]
      ] as const) {
        if (meta) artifacts.push(meta);
        else skipped.push(skip);
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
