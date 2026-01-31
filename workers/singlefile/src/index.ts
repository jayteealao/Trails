import puppeteer from '@cloudflare/puppeteer';
import { getR2Key, sha256 } from '@warg/shared';
import type { ArtifactMeta } from '@warg/shared';
import type {
  SinglefileRequest,
  SinglefileSuccessResponse,
  SinglefileRateLimitedResponse,
  SinglefileOptions
} from './types.js';

/**
 * SingleFile hook script - must be injected before page load.
 * Sets up the window.singlefile namespace and frame tracking.
 */
const SINGLEFILE_HOOK = `
(function() {
  if (window.singlefile) return;

  const SINGLE_FILE_PREFIX = "single-file-";

  window.singlefile = {
    frames: new Map(),
    sessionId: 0
  };

  // Track frames for resource capture
  const originalAppendChild = Element.prototype.appendChild;
  Element.prototype.appendChild = function(child) {
    if (child.tagName === 'IFRAME') {
      const frameId = SINGLE_FILE_PREFIX + (window.singlefile.sessionId++);
      child.dataset.singleFileFrameId = frameId;
    }
    return originalAppendChild.call(this, child);
  };
})();
`;

/**
 * SingleFile main script - the core capture logic.
 * This is a simplified version for Cloudflare Workers Browser Rendering.
 */
const SINGLEFILE_SCRIPT = `
(function() {
  if (window.singlefile && window.singlefile.getPageData) return;

  window.singlefile = window.singlefile || {};

  async function getPageData(options = {}) {
    const doc = document;
    const doctype = doc.doctype;
    const doctypeStr = doctype
      ? '<!DOCTYPE ' + doctype.name +
        (doctype.publicId ? ' PUBLIC "' + doctype.publicId + '"' : '') +
        (doctype.systemId ? ' "' + doctype.systemId + '"' : '') + '>'
      : '<!DOCTYPE html>';

    // Clone the document for processing
    const clonedDoc = doc.cloneNode(true);

    // Process the cloned document
    await processDocument(clonedDoc, options);

    // Serialize to string
    const html = doctypeStr + '\\n' + clonedDoc.documentElement.outerHTML;

    return { content: html };
  }

  async function processDocument(doc, options) {
    // Remove scripts if requested
    if (options.blockScripts) {
      doc.querySelectorAll('script').forEach(el => el.remove());
    }

    // Inline stylesheets
    await inlineStylesheets(doc);

    // Inline images
    if (!options.blockImages) {
      await inlineImages(doc);
    } else {
      doc.querySelectorAll('img').forEach(el => el.remove());
    }

    // Remove videos if requested
    if (options.blockVideos) {
      doc.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"]').forEach(el => el.remove());
    }

    // Add base tag for relative URLs
    const baseTag = doc.createElement('base');
    baseTag.href = window.location.href;
    const head = doc.querySelector('head');
    if (head) {
      head.insertBefore(baseTag, head.firstChild);
    }

    // Add meta charset
    if (!doc.querySelector('meta[charset]')) {
      const metaCharset = doc.createElement('meta');
      metaCharset.setAttribute('charset', 'utf-8');
      if (head) {
        head.insertBefore(metaCharset, head.firstChild);
      }
    }
  }

  async function inlineStylesheets(doc) {
    const styleSheets = doc.querySelectorAll('link[rel="stylesheet"]');
    for (const link of styleSheets) {
      try {
        const href = link.href;
        if (!href) continue;

        const response = await fetch(href);
        if (response.ok) {
          const css = await response.text();
          const style = doc.createElement('style');
          style.textContent = css;
          link.parentNode.replaceChild(style, link);
        }
      } catch (e) {
        console.warn('Failed to inline stylesheet:', e);
      }
    }
  }

  async function inlineImages(doc) {
    const images = doc.querySelectorAll('img[src]');
    for (const img of images) {
      try {
        const src = img.src;
        if (!src || src.startsWith('data:')) continue;

        const response = await fetch(src);
        if (response.ok) {
          const blob = await response.blob();
          const dataUrl = await blobToDataURL(blob);
          img.src = dataUrl;
        }
      } catch (e) {
        console.warn('Failed to inline image:', e);
      }
    }
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  window.singlefile.getPageData = getPageData;
})();
`;

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
  data: ArrayBuffer,
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

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    try {
      // Only accept POST /singlefile
      const url = new URL(request.url);
      if (request.method !== 'POST' || url.pathname !== '/singlefile') {
        return jsonResponse({ error: 'Not found' }, 404);
      }

      // Verify internal API key
      const apiKey = request.headers.get('X-Internal-API-Key');
      if (!apiKey || apiKey !== env.INTERNAL_API_KEY) {
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
      const cleanupScript = options.cleanupScript ?? DEFAULT_CLEANUP_SCRIPT;

      // Launch browser
      let browser;
      try {
        console.log('[singlefile] Launching browser...');
        browser = await puppeteer.launch(env.MYBROWSER);
        console.log('[singlefile] Browser launched successfully');
      } catch (err) {
        console.error('[singlefile] Browser launch failed:', err);
        // Check if it's a rate limit error
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

        // Inject hook script before navigation
        console.log('[singlefile] Injecting scripts...');
        await page.evaluateOnNewDocument(SINGLEFILE_HOOK);
        await page.evaluateOnNewDocument(SINGLEFILE_SCRIPT);

        // Navigate to the URL
        console.log('[singlefile] Navigating to:', targetUrl);
        await page.goto(targetUrl, {
          waitUntil: waitUntil as 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2',
          timeout
        });
        console.log('[singlefile] Navigation complete');

        // Run cleanup script
        console.log('[singlefile] Running cleanup script...');
        await page.evaluate(cleanupScript);

        // Scroll to trigger lazy loading
        if (scrollToBottom) {
          console.log('[singlefile] Scrolling page...');
          await page.evaluate(SCROLL_SCRIPT);
        }

        // Wait a bit for any final resources to load
        await page.evaluate(() => new Promise(r => setTimeout(r, 1000)));

        // Capture the page with SingleFile
        console.log('[singlefile] Capturing page...');
        const result = await page.evaluate(async (opts: { blockScripts?: boolean; blockImages?: boolean; blockVideos?: boolean }) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sf = (window as any).singlefile;
          if (!sf || !sf.getPageData) {
            throw new Error('SingleFile not available');
          }
          return sf.getPageData(opts);
        }, {
          blockScripts: options.blockScripts,
          blockImages: options.blockImages,
          blockVideos: options.blockVideos
        });

        if (!result || !result.content) {
          return jsonResponse(
            { error: 'SingleFile capture failed: no content returned' },
            502
          );
        }

        console.log('[singlefile] Storing artifact...');
        // Store the artifact
        const htmlData = new TextEncoder().encode(result.content);
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
      const stack = err instanceof Error ? err.stack : undefined;
      return jsonResponse({ error: 'Internal error', message: errMsg, stack }, 500);
    }
  }
};
