import {
  accessBlockedResponse,
  decodeBase64ToArrayBuffer,
  findReusableArtifact,
  isChallengePage,
  isProxyErrorPage,
  PROXY_ERROR_PAGE_REASON,
  storeArtifact,
  timingSafeEqual
} from '@warg/shared';
import type { ArtifactKind, ArtifactMeta } from '@warg/shared';
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

interface RenderFlags {
  includeScreenshot: boolean;
  includePdf: boolean;
  includeMarkdown: boolean;
}

/** The artifact kinds a render answers, in answer order, with the label of each and whether it was asked for. */
function answerOrder(flags: RenderFlags): Array<[ArtifactKind, boolean, string]> {
  return [
    ['rendered.html', true, 'html'],
    ['screenshot.png', flags.includeScreenshot, 'screenshot'],
    ['page.pdf', flags.includePdf, 'pdf'],
    ['rendered.md', flags.includeMarkdown, 'markdown']
  ];
}

function requestedKinds(flags: RenderFlags): ArtifactKind[] {
  return answerOrder(flags)
    .filter(([, isRequested]) => isRequested)
    .map(([kind]) => kind);
}

/**
 * What the one page load must fetch: the HTML always comes with a load (the page
 * detectors guard every load), plus each requested snapshot format that is not reused.
 */
function planPageLoad(flags: RenderFlags, reused: ReadonlyMap<ArtifactKind, ArtifactMeta>) {
  const missingScreenshot = flags.includeScreenshot && !reused.has('screenshot.png');
  const missingMarkdown = flags.includeMarkdown && !reused.has('rendered.md');
  const formats: BrowserRunSnapshotFormat[] = [
    'content',
    ...(missingScreenshot ? (['screenshot'] as const) : []),
    ...(missingMarkdown ? (['markdown'] as const) : [])
  ];
  const needsPageLoad = !reused.has('rendered.html') || missingScreenshot || missingMarkdown;
  return { needsPageLoad, missingScreenshot, missingMarkdown, formats };
}

/** The artifacts and skip notes of the answer, in the fixed answer order. */
function assembleAnswer(
  flags: RenderFlags,
  outcomes: ReadonlyMap<ArtifactKind, ArtifactMeta>,
  misses: ReadonlyMap<ArtifactKind, string>
): { artifacts: ArtifactMeta[]; skipped: string[] } {
  const artifacts: ArtifactMeta[] = [];
  const skipped: string[] = [];
  for (const [kind, isRequested, label] of answerOrder(flags)) {
    const meta = outcomes.get(kind);
    if (!isRequested) skipped.push(`${label}: not requested`);
    else if (meta) artifacts.push(meta);
    else {
      const miss = misses.get(kind);
      if (miss) skipped.push(miss);
    }
  }
  return { artifacts, skipped };
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
      const reuseScope = typeof body.reuse_scope === 'string' && body.reuse_scope ? body.reuse_scope : undefined;

      // Artifacts that an earlier attempt of this run already stored are listed again, not loaded again.
      const flags: RenderFlags = { includeScreenshot, includePdf, includeMarkdown };
      const reused = new Map<ArtifactKind, ArtifactMeta>();
      if (reuseScope) {
        const found = await Promise.all(
          requestedKinds(flags).map((kind) => findReusableArtifact(env.ARCHIVE_BUCKET, request_id, kind, reuseScope))
        );
        for (const meta of found) {
          if (meta) reused.set(meta.kind, meta);
        }
      }
      const { needsPageLoad, missingScreenshot, missingMarkdown, formats } = planPageLoad(flags, reused);
      const outcomes = new Map<ArtifactKind, ArtifactMeta>(reused);
      const misses = new Map<ArtifactKind, string>();
      const browserApiStart = Date.now();

      // 1. One page load for whatever of the HTML, screenshot and Markdown is missing
      if (needsPageLoad) {
        let action: 'snapshot' | 'content' = formats.length >= 2 ? 'snapshot' : 'content';
        let pageResp = await loadPage(env, targetUrl, formats);
        let pageRateLimit = checkRateLimit(pageResp, '');
        if (pageRateLimit) return pageRateLimit;
        if (!pageResp.ok && action === 'snapshot' && pageResp.status !== 403) {
          // A failed snapshot must not lose the HTML: load the HTML alone once, and skip the other formats.
          console.error(
            '[renderer] snapshot load failed, retrying the HTML alone',
            JSON.stringify({ request_id, action: 'snapshot', formats, status: pageResp.status })
          );
          const snapshotStatus = pageResp.status;
          await pageResp.body?.cancel();
          if (missingScreenshot) misses.set('screenshot.png', `screenshot: snapshot failed with ${snapshotStatus}`);
          if (missingMarkdown) misses.set('rendered.md', `markdown: snapshot failed with ${snapshotStatus}`);
          action = 'content';
          pageResp = await loadPage(env, targetUrl, ['content']);
          pageRateLimit = checkRateLimit(pageResp, '');
          if (pageRateLimit) return pageRateLimit;
        }
        if (!pageResp.ok) {
          const errorText = await pageResp.text();
          console.error(
            '[renderer] page load failed',
            JSON.stringify({ request_id, action, status: pageResp.status })
          );
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

        // 2. Store the artifacts of this load before the PDF load, so a PDF failure keeps them
        if (!reused.has('rendered.html')) {
          const htmlData = new TextEncoder().encode(page.html);
          outcomes.set(
            'rendered.html',
            await storeArtifact(env.ARCHIVE_BUCKET, request_id, 'rendered.html', htmlData.buffer as ArrayBuffer, 'text/html', reuseScope)
          );
        }
        if (missingScreenshot) {
          if (page.screenshot) {
            outcomes.set(
              'screenshot.png',
              await storeArtifact(env.ARCHIVE_BUCKET, request_id, 'screenshot.png', decodeScreenshot(page.screenshot), 'image/png', reuseScope)
            );
          } else {
            misses.set('screenshot.png', misses.get('screenshot.png') ?? 'screenshot: snapshot returned no screenshot');
          }
        }
        if (missingMarkdown) {
          if (page.markdown) {
            const mdData = new TextEncoder().encode(page.markdown);
            outcomes.set(
              'rendered.md',
              await storeArtifact(env.ARCHIVE_BUCKET, request_id, 'rendered.md', mdData.buffer as ArrayBuffer, 'text/markdown', reuseScope)
            );
          } else {
            misses.set('rendered.md', misses.get('rendered.md') ?? 'markdown: snapshot returned no markdown');
          }
        }
      }

      // 3. PDF, when requested and missing, takes its own load
      if (includePdf && !reused.has('page.pdf')) {
        const pdfResp = await env.BROWSER.quickAction('pdf', { url: targetUrl, gotoOptions: GOTO_OPTIONS });
        const pdfRateLimit = checkRateLimit(pdfResp, 'PDF');
        if (pdfRateLimit) return pdfRateLimit;
        if (pdfResp.ok) {
          const pdfData = await pdfResp.arrayBuffer();
          outcomes.set(
            'page.pdf',
            await storeArtifact(env.ARCHIVE_BUCKET, request_id, 'page.pdf', pdfData, 'application/pdf', reuseScope)
          );
        } else {
          misses.set('page.pdf', `pdf: API returned ${pdfResp.status}`);
        }
      }

      // 4. The answer lists every artifact of the request, stored now or reused, in a fixed order
      const { artifacts, skipped } = assembleAnswer(flags, outcomes, misses);

      const browserApiMs = Date.now() - browserApiStart;
      const successResponse: RenderSuccessResponse = {
        uses_browser_rendering: true,
        quota_kind_used: browser_quota_kind,
        artifacts,
        meta: { skipped, browserApiMs, ...(reused.size > 0 && { reused: [...reused.keys()] }) }
      };
      return Response.json(successResponse);
    } catch (err) {
      console.error('[renderer] Unhandled error:', err);
      const errMsg = err instanceof Error ? err.message : String(err);
      return Response.json({ error: 'Internal error', message: errMsg }, { status: 500 });
    }
  }
};
