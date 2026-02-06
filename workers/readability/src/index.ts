import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { getR2Key, sha256 } from '@warg/shared';
import type { ArtifactMeta } from '@warg/shared';
import type {
  ReadabilityRequest,
  ReadabilityResult,
  ReadabilitySuccessResponse
} from './types.js';
import { toMarkdown } from './markdown.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function storeArtifact(
  bucket: R2Bucket,
  requestId: string,
  kind: 'readability.json' | 'readability.md',
  data: ArrayBuffer,
  contentType: string
): Promise<ArtifactMeta> {
  const r2Key = getR2Key(requestId, kind);
  const hash = await sha256(data);
  await bucket.put(r2Key, data, {
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

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (request.method !== 'POST' || url.pathname !== '/readability') {
        return jsonResponse({ error: 'Not found' }, 404);
      }

      // Verify internal API key
      const apiKey = request.headers.get('X-Internal-API-Key');
      if (!apiKey || apiKey !== env.INTERNAL_API_KEY) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      // Parse request body
      let body: ReadabilityRequest;
      try {
        body = (await request.json()) as ReadabilityRequest;
      } catch {
        return jsonResponse({ error: 'Invalid JSON' }, 400);
      }

      const { request_id, rendered_html_key } = body;
      if (!request_id || !rendered_html_key) {
        return jsonResponse(
          { error: 'Missing required fields: request_id, rendered_html_key' },
          400
        );
      }

      // Fetch HTML from R2
      console.log('[readability] Fetching HTML from R2:', rendered_html_key);
      const htmlObject = await env.ARCHIVE_BUCKET.get(rendered_html_key);
      if (!htmlObject) {
        return jsonResponse(
          { error: 'HTML not found in R2', key: rendered_html_key },
          404
        );
      }

      const html = await htmlObject.text();
      console.log('[readability] HTML fetched, length:', html.length);

      if (html.length < 100) {
        return jsonResponse(
          { error: 'HTML content too short', length: html.length },
          400
        );
      }

      // Parse HTML with linkedom
      console.log('[readability] Parsing HTML with linkedom...');
      const { document } = parseHTML(html);

      // Run Readability
      console.log('[readability] Running Readability extraction...');
      const reader = new Readability(document);
      const article = reader.parse();

      if (!article) {
        return jsonResponse(
          { error: 'Readability could not extract article content' },
          422
        );
      }

      console.log('[readability] Extraction complete:', {
        title: article.title,
        byline: article.byline,
        length: article.length
      });

      // Prepare outputs
      const readabilityResult: ReadabilityResult = {
        title: article.title,
        byline: article.byline,
        dir: article.dir,
        lang: article.lang,
        content: article.content,
        textContent: article.textContent,
        length: article.length,
        excerpt: article.excerpt,
        siteName: article.siteName,
        publishedTime: article.publishedTime
      };

      const jsonContent = JSON.stringify(readabilityResult, null, 2);
      const mdContent = toMarkdown(readabilityResult);

      // Store artifacts
      console.log('[readability] Storing JSON artifact...');
      const jsonData = new TextEncoder().encode(jsonContent);
      const jsonMeta = await storeArtifact(
        env.ARCHIVE_BUCKET,
        request_id,
        'readability.json',
        jsonData.buffer as ArrayBuffer,
        'application/json'
      );

      console.log('[readability] Storing MD artifact...');
      const mdData = new TextEncoder().encode(mdContent);
      const mdMeta = await storeArtifact(
        env.ARCHIVE_BUCKET,
        request_id,
        'readability.md',
        mdData.buffer as ArrayBuffer,
        'text/markdown'
      );

      console.log('[readability] Success!');
      const response: ReadabilitySuccessResponse = {
        json: jsonMeta,
        md: mdMeta,
        meta: {
          title: article.title,
          byline: article.byline,
          textLength: article.textContent?.length ?? 0,
          excerptLength: article.excerpt?.length ?? 0
        }
      };
      return jsonResponse(response);
    } catch (err) {
      console.error('[readability] Unhandled error:', err);
      const errMsg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      return jsonResponse({ error: 'Internal error', message: errMsg, stack }, 500);
    }
  }
};
