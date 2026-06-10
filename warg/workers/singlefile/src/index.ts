import puppeteer from '@cloudflare/puppeteer';
import { storeArtifact, timingSafeEqual } from '@warg/shared';
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
  const maxScrollTime = 3000;
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

/**
 * Guard against page environments that break selector evaluation or rely on Trusted Types globals.
 * This runs before page scripts and before SingleFile injection.
 */
const HARDENING_SCRIPT = `
(function() {
  try {
    const g = globalThis;

    if (typeof g.trustedTypes === 'undefined') {
      const policyNames = [];
      g.trustedTypes = {
        createPolicy(name, rules) {
          if (!policyNames.includes(name)) {
            policyNames.push(name);
          }
          return {
            name,
            createHTML: (input) => (rules && typeof rules.createHTML === 'function' ? rules.createHTML(input) : input),
            createScript: (input) => (rules && typeof rules.createScript === 'function' ? rules.createScript(input) : input),
            createScriptURL: (input) => (rules && typeof rules.createScriptURL === 'function' ? rules.createScriptURL(input) : input),
          };
        },
        getPolicyNames() {
          return policyNames.slice();
        },
        emptyHTML: '',
        emptyScript: '',
      };
    }

    if (typeof g.TrustedHTML === 'undefined') g.TrustedHTML = String;
    if (typeof g.TrustedScript === 'undefined') g.TrustedScript = String;
    if (typeof g.TrustedScriptURL === 'undefined') g.TrustedScriptURL = String;

    const emptyNodeList = () => document.createDocumentFragment().querySelectorAll('*');

    const wrapQuerySelector = (proto, methodName, fallbackValue) => {
      if (!proto || typeof proto[methodName] !== 'function') return;
      const original = proto[methodName];
      proto[methodName] = function(selector) {
        try {
          return original.call(this, selector);
        } catch (err) {
          const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : '';
          if (
            err instanceof DOMException ||
            message.includes('not a valid selector') ||
            message.includes('Failed to execute')
          ) {
            return fallbackValue();
          }
          throw err;
        }
      };
    };

    wrapQuerySelector(Document.prototype, 'querySelector', () => null);
    wrapQuerySelector(Document.prototype, 'querySelectorAll', () => emptyNodeList());
    wrapQuerySelector(Element.prototype, 'querySelector', () => null);
    wrapQuerySelector(Element.prototype, 'querySelectorAll', () => emptyNodeList());
  } catch (err) {
    // Do not block capture if hardening script itself fails.
    console.warn('[singlefile] hardening script failed', err);
  }
})();
`;

function isSinglefileEdgeCaseError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();
  return (
    lower.includes('trustedtypes') ||
    lower.includes('trustedhtml') ||
    lower.includes('failed to execute') ||
    lower.includes('not a valid selector')
  );
}

/**
 * Build SingleFile native options from our options interface.
 */
function buildNativeOptions(options: SinglefileOptions): SinglefileNativeOptions {
  return {
    removeHiddenElements: options.removeHiddenElements ?? true,
    removeUnusedStyles: options.removeUnusedStyles ?? true,
    removeUnusedFonts: options.removeUnusedFonts ?? true,
    compressHTML: options.compressHTML ?? true,
    blockScripts: options.blockScripts ?? true,
    blockVideos: options.blockVideos ?? true,
    blockAudios: options.blockAudios ?? true,
    removeFrames: options.removeFrames ?? false,
    removeAlternativeImages: options.removeAlternativeImages ?? false
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

      if (request.method !== 'POST' || url.pathname !== '/singlefile') {
        return Response.json({ error: 'Not found' }, { status: 404 });
      }

      // Verify internal API key
      const apiKey = request.headers.get('X-Internal-API-Key');
      if (!apiKey || !timingSafeEqual(apiKey, env.INTERNAL_API_KEY)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }

      // Parse request body
      let body: SinglefileRequest;
      try {
        body = (await request.json()) as SinglefileRequest;
      } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 });
      }

      const { request_id, url: targetUrl, options_r2_key } = body;
      if (!request_id || !targetUrl) {
        return Response.json(
          { error: 'Missing required fields: request_id, url' },
          { status: 400 }
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
        browser = await puppeteer.launch(env.MYBROWSER, { keep_alive: 120000 });
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
          return Response.json(rateLimited, { status: 429 });
        }
        return Response.json({ error: 'Browser launch failed', details: errMsg }, { status: 500 });
      }

      try {
        console.log('[singlefile] Creating new page...');
        const page = await browser.newPage();
        page.setDefaultTimeout(30000);
        page.on('error', (err) => {
          console.error('[singlefile] Page crashed:', err.message);
        });
        console.log('[singlefile] Page created');

        // Step 1: Navigate
        console.log('[singlefile] Injecting hardening + SingleFile hook scripts...');
        await page.evaluateOnNewDocument(HARDENING_SCRIPT);
        await page.evaluateOnNewDocument(SINGLEFILE_HOOK);

        console.log('[singlefile] Navigating to:', targetUrl);
        await page.goto(targetUrl, {
          waitUntil: waitUntil as 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2',
          timeout
        });
        console.log('[singlefile] Navigation complete');

        // Step 2: Cleanup + scroll
        console.log('[singlefile] Running cleanup script...');
        try {
          await page.evaluate(cleanupScript);
        } catch (cleanupErr) {
          // Cleanup should not fail the archive capture.
          console.warn('[singlefile] Cleanup script failed, continuing:', cleanupErr);
        }

        if (scrollToBottom) {
          console.log('[singlefile] Scrolling page to trigger lazy loading...');
          try {
            await page.evaluate(SCROLL_SCRIPT);
          } catch (scrollErr) {
            // Scrolling failures should not hard-fail capture.
            console.warn('[singlefile] Scroll script failed, continuing:', scrollErr);
          }
        }

        // Step 3: Inject SingleFile
        console.log('[singlefile] Injecting SingleFile main script...');
        await page.evaluate(SINGLEFILE_SCRIPT);

        // Step 4: Verify + Capture
        const singlefileAvailable = await page.evaluate(() => {
           
          const runtime = globalThis as unknown as { singlefile?: { getPageData?: unknown } };
          return typeof runtime.singlefile !== 'undefined' &&
             
            typeof runtime.singlefile?.getPageData === 'function';
        });

        if (!singlefileAvailable) {
          return Response.json(
            { error: 'SingleFile injection failed: singlefile.getPageData not available' },
            { status: 502 }
          );
        }

        console.log('[singlefile] Capturing page with SingleFile...');
        const captureTimeoutMs = 45000;

        let result: unknown;
        try {
          result = await Promise.race([
            page.evaluate(async (opts: SinglefileNativeOptions) => {
               
              const runtime = globalThis as unknown as { singlefile: { getPageData: (options: SinglefileNativeOptions) => Promise<unknown> } };
              const sf = runtime.singlefile;
              return await sf.getPageData(opts);
            }, nativeOptions),
            new Promise<null>((_, reject) =>
              setTimeout(() => reject(new Error('SingleFile capture timeout')), captureTimeoutMs)
            )
          ]);
        } catch (captureErr) {
          if (isSinglefileEdgeCaseError(captureErr)) {
            const details = captureErr instanceof Error ? captureErr.message : String(captureErr);
            return Response.json(
              {
                error: 'SingleFile edge-case failure',
                details,
                recoverable: true
              },
              { status: 422 }
            );
          }
          throw captureErr;
        }

        if (!result || typeof result !== 'object' || !('content' in result)) {
          return Response.json(
            { error: 'SingleFile capture failed: no content returned' },
            { status: 502 }
          );
        }

        const content = (result as { content: string }).content;

        // Validate content
        if (!content || content.length < 100) {
          return Response.json(
            { error: 'SingleFile capture failed: content too short', length: content?.length },
            { status: 502 }
          );
        }

        console.log('[singlefile] Capture complete, content length:', content.length);

        // Step 5: Store artifact
        console.log('[singlefile] Storing artifact...');
        const htmlData = new TextEncoder().encode(content);
        const artifact = await storeArtifact(env.ARCHIVE_BUCKET, request_id, 'singlefile.html', htmlData.buffer as ArrayBuffer, 'text/html');

        console.log('[singlefile] Success!');
        const successResponse: SinglefileSuccessResponse = { artifact };
        return Response.json(successResponse);
      } finally {
        try {
          await browser.close();
        } catch {
          // Browser already closed — expected after TargetCloseError
        }
      }
    } catch (err) {
      console.error('[singlefile] Unhandled error:', err);
      const errMsg = err instanceof Error ? err.message : String(err);
      return Response.json({ error: 'Internal error', message: errMsg }, { status: 500 });
    }
  }
};
