import { getR2Key, sha256, timingSafeEqual } from '@warg/shared';
import type { ArtifactMeta } from '@warg/shared';
import type {
  RenderRequest,
  RenderSuccessResponse,
  RenderRateLimitedResponse,
  RendererOptions,
  BrowserQuotaKind
} from './types.js';

const BR_BASE = 'https://api.cloudflare.com/client/v4/accounts';

interface BrowserRenderingRequest {
  url: string;
  gotoOptions?: { waitUntil?: string };
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
    gotoOptions: { waitUntil: 'networkidle0' }
  };
}

async function storeArtifact(
  env: Env,
  requestId: string,
  kind: 'rendered.html' | 'rendered.md' | 'screenshot.png' | 'page.pdf',
  data: ArrayBuffer,
  contentType: string
): Promise<ArtifactMeta> {
  const r2Key = getR2Key(requestId, kind);
  const hash = await sha256(data);
  await env.ARCHIVE_BUCKET.put(r2Key, data, {
    httpMetadata: { contentType }
  });
  return {
    kind,
    r2Key,
    bytes: data.byteLength,
    sha256: hash,
    contentType
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
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
      return jsonResponse({ error: 'Not found' }, 404);
    }

    // Verify internal API key
    const apiKey = request.headers.get('X-Internal-API-Key');
    if (!apiKey || !timingSafeEqual(apiKey, env.INTERNAL_API_KEY)) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    // Parse request body
    let body: RenderRequest;
    try {
      body = (await request.json()) as RenderRequest;
    } catch {
      return jsonResponse({ error: 'Invalid JSON' }, 400);
    }

    const { request_id, url: targetUrl, options_r2_key, browser_quota_kind } = body;
    if (!request_id || !targetUrl || !browser_quota_kind) {
      return jsonResponse(
        { error: 'Missing required fields: request_id, url, browser_quota_kind' },
        400
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
    const quotaKindUsed: BrowserQuotaKind = browser_quota_kind;
    const browserApiStart = Date.now();

    // 1. Fetch rendered HTML
    const contentResp = await callBrowserRendering(env, 'content', brPayload);
    if (contentResp.status === 429) {
      const retryAfter = contentResp.headers.get('Retry-After');
      const retryMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
      const rateLimited: RenderRateLimitedResponse = {
        error: 'rate_limited',
        retry_after_ms: retryMs,
        message: 'Browser Rendering rate limited'
      };
      return jsonResponse(rateLimited, 429);
    }
    if (!contentResp.ok) {
      const errorText = await contentResp.text();
      return jsonResponse(
        { error: 'Browser Rendering /content failed', status: contentResp.status, details: errorText },
        502
      );
    }
    // Browser Rendering /content returns JSON: { success: true, result: "html content", meta: {...} }
    const contentJson = (await contentResp.json()) as { success: boolean; result: string };
    if (!contentJson.success || !contentJson.result) {
      return jsonResponse(
        { error: 'Browser Rendering /content returned invalid response' },
        502
      );
    }
    const htmlData = new TextEncoder().encode(contentJson.result);
    const htmlMeta = await storeArtifact(env, request_id, 'rendered.html', htmlData.buffer, 'text/html');
    artifacts.push(htmlMeta);

    // 2. Fetch screenshot if requested
    if (includeScreenshot) {
      const ssResp = await callBrowserRendering(env, 'screenshot', brPayload);
      if (ssResp.status === 429) {
        const retryAfter = ssResp.headers.get('Retry-After');
        const retryMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
        const rateLimited: RenderRateLimitedResponse = {
          error: 'rate_limited',
          retry_after_ms: retryMs,
          message: 'Browser Rendering rate limited on screenshot'
        };
        return jsonResponse(rateLimited, 429);
      }
      if (ssResp.ok) {
        const ssData = await ssResp.arrayBuffer();
        const ssMeta = await storeArtifact(env, request_id, 'screenshot.png', ssData, 'image/png');
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
      if (pdfResp.status === 429) {
        const retryAfter = pdfResp.headers.get('Retry-After');
        const retryMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
        const rateLimited: RenderRateLimitedResponse = {
          error: 'rate_limited',
          retry_after_ms: retryMs,
          message: 'Browser Rendering rate limited on PDF'
        };
        return jsonResponse(rateLimited, 429);
      }
      if (pdfResp.ok) {
        const pdfData = await pdfResp.arrayBuffer();
        const pdfMeta = await storeArtifact(env, request_id, 'page.pdf', pdfData, 'application/pdf');
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
      if (mdResp.status === 429) {
        const retryAfter = mdResp.headers.get('Retry-After');
        const retryMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
        const rateLimited: RenderRateLimitedResponse = {
          error: 'rate_limited',
          retry_after_ms: retryMs,
          message: 'Browser Rendering rate limited on markdown'
        };
        return jsonResponse(rateLimited, 429);
      }
      if (mdResp.ok) {
        // Browser Rendering /markdown returns JSON: { success: true, result: "markdown content" }
        const mdJson = (await mdResp.json()) as { success: boolean; result: string };
        if (mdJson.success && mdJson.result) {
          const mdData = new TextEncoder().encode(mdJson.result);
          const mdMeta = await storeArtifact(env, request_id, 'rendered.md', mdData.buffer, 'text/markdown');
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
      quota_kind_used: quotaKindUsed,
      artifacts,
      meta: { skipped, browserApiMs }
    };
    return jsonResponse(successResponse);
    } catch (err) {
      console.error('[renderer] Unhandled error:', err);
      const errMsg = err instanceof Error ? err.message : String(err);
      return jsonResponse({ error: 'Internal error', message: errMsg }, 500);
    }
  }
};
