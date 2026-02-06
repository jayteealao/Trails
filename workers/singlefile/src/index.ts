import puppeteer from '@cloudflare/puppeteer';
import { getR2Key, sha256, timingSafeEqual } from '@warg/shared';
import type { ArtifactMeta } from '@warg/shared';
import { SINGLEFILE_SCRIPT, SINGLEFILE_HOOK } from './singlefile-bundle.js';
import type {
  SinglefileRequest,
  SinglefileSuccessResponse,
  SinglefileRateLimitedResponse,
  SinglefileOptions,
  SinglefileNativeOptions
} from './types.js';

/**
 * Default cleanup script to remove modals, popovers, cookie banners.
 */
const DEFAULT_CLEANUP_SCRIPT = `
(function() {
  const selectors = [
    '[role="dialog"]', '[aria-modal="true"]',
    '.modal', '.popup', '.overlay', '.lightbox',
    '[class*="cookie"]', '[id*="cookie"]',
    '[class*="consent"]', '[id*="consent"]',
    '[class*="gdpr"]', '[id*="gdpr"]',
    '[class*="notice"]', '[id*="notice"]',
    '.newsletter-popup', '.email-popup',
    '[class*="subscribe"]'
  ];
  selectors.forEach(s => {
    try {
      document.querySelectorAll(s).forEach(el => {
        if (el.offsetWidth > 0 && el.offsetHeight > 0) {
          el.remove();
        }
      });
    } catch (e) {}
  });
  document.body.style.overflow = 'auto';
  document.documentElement.style.overflow = 'auto';
})();
`;

/**
 * Scroll script to trigger lazy-loaded content.
 */
const SCROLL_SCRIPT = `
(async function() {
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const maxScrollTime = 5000;
  const scrollStep = 400;
  const scrollDelay = 150;
  const startTime = Date.now();

  let previousHeight = 0;
  let currentHeight = document.body.scrollHeight;

  while (Date.now() - startTime < maxScrollTime) {
    window.scrollBy(0, scrollStep);
    await delay(scrollDelay);

    previousHeight = currentHeight;
    currentHeight = document.body.scrollHeight;

    // If we've reached the bottom and height hasn't changed
    if (window.innerHeight + window.scrollY >= currentHeight - 10) {
      await delay(500); // Wait for potential lazy load
      if (document.body.scrollHeight === currentHeight) {
        break;
      }
    }
  }

  // Scroll back to top
  window.scrollTo(0, 0);
  await delay(100);
})();
`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function storeArtifact(
  env: Env,
  requestId: string,
  data: ArrayBuffer
): Promise<ArtifactMeta> {
  const r2Key = getR2Key(requestId, 'singlefile.html');
  const hash = await sha256(data);
  await env.ARCHIVE_BUCKET.put(r2Key, data, {
    httpMetadata: { contentType: 'text/html' }
  });
  return {
    kind: 'singlefile.html',
    r2Key,
    bytes: data.byteLength,
    sha256: hash,
    contentType: 'text/html'
  };
}

/**
 * Build SingleFile native options from our options interface.
 */
function buildNativeOptions(options: SinglefileOptions): SinglefileNativeOptions {
  return {
    removeHiddenElements: options.removeHiddenElements ?? true,
    removeUnusedStyles: options.removeUnusedStyles ?? true,
    removeUnusedFonts: options.removeUnusedFonts ?? true,
    compressHTML: options.compressHTML ?? options.compressContent ?? true,
    blockScripts: options.blockScripts ?? true,
    blockVideos: options.blockVideos ?? true,
    blockAudios: options.blockAudios ?? true,
    removeFrames: options.removeFrames ?? false,
    removeAlternativeImages: options.removeAlternativeImages ?? options.blockImages ?? false
  };
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    try {
      const url = new URL(request.url);

      // Accept both /singlefile and /extract for backward compatibility
      if (request.method !== 'POST' || (url.pathname !== '/singlefile' && url.pathname !== '/extract')) {
        return jsonResponse({ error: 'Not found' }, 404);
      }

      // Verify internal API key
      const apiKey = request.headers.get('X-Internal-API-Key');
      if (!apiKey || !timingSafeEqual(apiKey, env.INTERNAL_API_KEY)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      // Parse request body
      let body: SinglefileRequest;
      try {
        body = (await request.json()) as SinglefileRequest;
      } catch {
        return jsonResponse({ error: 'Invalid JSON' }, 400);
      }

      const { request_id, url: targetUrl, options_r2_key } = body;
      if (!request_id || !targetUrl) {
        return jsonResponse(
          { error: 'Missing required fields: request_id, url' },
          400
        );
      }

      // Read options from R2 if provided
      let options: SinglefileOptions = {};
      if (options_r2_key) {
        const obj = await env.ARCHIVE_BUCKET.get(options_r2_key);
        if (obj) {
          try {
            options = (await obj.json()) as SinglefileOptions;
          } catch {
            // Fall back to defaults if options can't be parsed
          }
        }
      }

      // Apply defaults
      const scrollToBottom = options.scrollToBottom ?? true;
      const waitUntil = options.waitUntil ?? 'load';
      const timeout = options.timeout ?? 60000;
      const cleanupScript = DEFAULT_CLEANUP_SCRIPT;

      // Build native options for SingleFile
      const nativeOptions = buildNativeOptions(options);

      // Launch browser
      let browser;
      try {
        console.log('[singlefile] Launching browser...');
        browser = await puppeteer.launch(env.MYBROWSER);
        console.log('[singlefile] Browser launched successfully');
      } catch (err) {
        console.error('[singlefile] Browser launch failed:', err);
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes('limit') || errMsg.includes('quota')) {
          const rateLimited: SinglefileRateLimitedResponse = {
            error: 'rate_limited',
            retry_after_ms: 5000,
            message: 'Browser session limit reached'
          };
          return jsonResponse(rateLimited, 429);
        }
        return jsonResponse({ error: 'Browser launch failed', details: errMsg }, 500);
      }

      try {
        console.log('[singlefile] Creating new page...');
        const page = await browser.newPage();
        console.log('[singlefile] Page created');

        // Inject SingleFile hook script before navigation (for frame tracking)
        console.log('[singlefile] Injecting SingleFile hook script...');
        await page.evaluateOnNewDocument(SINGLEFILE_HOOK);

        // Navigate to the URL
        console.log('[singlefile] Navigating to:', targetUrl);
        await page.goto(targetUrl, {
          waitUntil: waitUntil as 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2',
          timeout
        });
        console.log('[singlefile] Navigation complete');

        // Run cleanup script to remove modals, banners, etc.
        console.log('[singlefile] Running cleanup script...');
        await page.evaluate(cleanupScript);

        // Scroll to trigger lazy loading
        if (scrollToBottom) {
          console.log('[singlefile] Scrolling page to trigger lazy loading...');
          await page.evaluate(SCROLL_SCRIPT);
        }

        // Wait a bit for any final resources to load
        await page.evaluate(() => new Promise((r) => setTimeout(r, 1000)));

        // Inject the main SingleFile script
        console.log('[singlefile] Injecting SingleFile main script...');
        await page.evaluate(SINGLEFILE_SCRIPT);

        // Verify SingleFile is available
        const singlefileAvailable = await page.evaluate(() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return typeof (window as any).singlefile !== 'undefined' &&
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            typeof (window as any).singlefile.getPageData === 'function';
        });

        if (!singlefileAvailable) {
          return jsonResponse(
            { error: 'SingleFile injection failed: singlefile.getPageData not available' },
            502
          );
        }

        // Capture the page with SingleFile (with timeout)
        console.log('[singlefile] Capturing page with SingleFile...');
        const captureTimeoutMs = 60000;

        const result = await Promise.race([
          page.evaluate(async (opts: SinglefileNativeOptions) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const sf = (window as any).singlefile;
            return await sf.getPageData(opts);
          }, nativeOptions),
          new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error('SingleFile capture timeout')), captureTimeoutMs)
          )
        ]);

        if (!result || typeof result !== 'object' || !('content' in result)) {
          return jsonResponse(
            { error: 'SingleFile capture failed: no content returned' },
            502
          );
        }

        const content = (result as { content: string }).content;

        // Validate content
        if (!content || content.length < 100) {
          return jsonResponse(
            { error: 'SingleFile capture failed: content too short', length: content?.length },
            502
          );
        }

        console.log('[singlefile] Capture complete, content length:', content.length);

        // Store the artifact
        console.log('[singlefile] Storing artifact...');
        const htmlData = new TextEncoder().encode(content);
        const artifact = await storeArtifact(env, request_id, htmlData.buffer as ArrayBuffer);

        console.log('[singlefile] Success!');
        const successResponse: SinglefileSuccessResponse = { artifact };
        return jsonResponse(successResponse);
      } finally {
        console.log('[singlefile] Closing browser...');
        await browser.close();
      }
    } catch (err) {
      console.error('[singlefile] Unhandled error:', err);
      const errMsg = err instanceof Error ? err.message : String(err);
      return jsonResponse({ error: 'Internal error', message: errMsg }, 500);
    }
  }
};
