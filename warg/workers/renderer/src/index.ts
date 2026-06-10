import { storeArtifact, timingSafeEqual } from '@warg/shared';
import type { ArtifactMeta } from '@warg/shared';
import type {
  RenderRequest,
  RenderSuccessResponse,
  RenderRateLimitedResponse,
  RendererOptions
} from './types.js';

const BR_BASE = 'https://api.cloudflare.com/client/v4/accounts';

interface BrowserRenderingRequest {
  url: string;
  gotoOptions?: { waitUntil?: string; timeout?: number };
}

async function callBrowserRendering(
  env: Env,
  endpoint: 'content' | 'screenshot' | 'pdf' | 'markdown',
  payload: BrowserRenderingRequest
): Promise<Response> {
  const url = `${BR_BASE}/${env.CF_ACCOUNT_ID}/browser-rendering/${endpoint}`;
  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.BR_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
}

function buildBrPayload(url: string): BrowserRenderingRequest {
  return {
    url,
    gotoOptions: { waitUntil: 'load', timeout: 30000 }
  };
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

      const brPayload = buildBrPayload(targetUrl);
      const artifacts: ArtifactMeta[] = [];
      const skipped: string[] = [];
      const browserApiStart = Date.now();

      // 1. Fetch rendered HTML
      const contentResp = await callBrowserRendering(env, 'content', brPayload);
      const contentRateLimit = checkRateLimit(contentResp, '');
      if (contentRateLimit) return contentRateLimit;
      if (!contentResp.ok) {
        const errorText = await contentResp.text();
        return Response.json(
          { error: 'Browser Rendering /content failed', status: contentResp.status, details: errorText },
          { status: 502 }
        );
      }
      // Browser Rendering /content returns JSON: { success: true, result: "html content", meta: {...} }
      const contentJson = (await contentResp.json()) as { success: boolean; result: string };
      if (!contentJson.success || !contentJson.result) {
        return Response.json(
          { error: 'Browser Rendering /content returned invalid response' },
          { status: 502 }
        );
      }
      const htmlData = new TextEncoder().encode(contentJson.result);
      const htmlMeta = await storeArtifact(
        env.ARCHIVE_BUCKET,
        request_id,
        'rendered.html',
        htmlData.buffer as ArrayBuffer,
        'text/html'
      );
      artifacts.push(htmlMeta);

      // 2. Fetch screenshot if requested
      if (includeScreenshot) {
        const ssResp = await callBrowserRendering(env, 'screenshot', brPayload);
        const ssRateLimit = checkRateLimit(ssResp, 'screenshot');
        if (ssRateLimit) return ssRateLimit;
        if (ssResp.ok) {
          const ssData = await ssResp.arrayBuffer();
          const ssMeta = await storeArtifact(env.ARCHIVE_BUCKET, request_id, 'screenshot.png', ssData, 'image/png');
          artifacts.push(ssMeta);
        } else {
          skipped.push(`screenshot: API returned ${ssResp.status}`);
        }
      } else {
        skipped.push('screenshot: not requested');
      }

      // 3. Fetch PDF if requested
      if (includePdf) {
        const pdfResp = await callBrowserRendering(env, 'pdf', brPayload);
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

      // 4. Fetch markdown if requested
      if (includeMarkdown) {
        const mdResp = await callBrowserRendering(env, 'markdown', brPayload);
        const mdRateLimit = checkRateLimit(mdResp, 'markdown');
        if (mdRateLimit) return mdRateLimit;
        if (mdResp.ok) {
          // Browser Rendering /markdown returns JSON: { success: true, result: "markdown content" }
          const mdJson = (await mdResp.json()) as { success: boolean; result: string };
          if (mdJson.success && mdJson.result) {
            const mdData = new TextEncoder().encode(mdJson.result);
            const mdMeta = await storeArtifact(
              env.ARCHIVE_BUCKET,
              request_id,
              'rendered.md',
              mdData.buffer as ArrayBuffer,
              'text/markdown'
            );
            artifacts.push(mdMeta);
          } else {
            skipped.push('markdown: API returned invalid response');
          }
        } else {
          skipped.push(`markdown: API returned ${mdResp.status}`);
        }
      } else {
        skipped.push('markdown: not requested');
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
