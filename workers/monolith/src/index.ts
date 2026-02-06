import { getSandbox, type Sandbox } from '@cloudflare/sandbox';
import { getR2Key, sha256 } from '@warg/shared';
import type { ArtifactMeta } from '@warg/shared/types';
import type { MonolithRequest, MonolithSuccessResponse } from './types.js';

// Re-export Sandbox for Durable Object binding
export { Sandbox } from '@cloudflare/sandbox';

// Monolith CLI flags for creating clean single-file HTML
const MONOLITH_FLAGS = [
  '-j', // remove JavaScript
  '-a', // remove audio
  '-v', // remove video
  '-F' // remove frames/iframes
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Store artifact to R2 and return metadata.
 */
async function storeArtifact(
  bucket: R2Bucket,
  requestId: string,
  kind: 'monolith.html',
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

/**
 * Execute monolith in sandbox and return processed HTML.
 */
async function runMonolithInSandbox(
  env: Env,
  requestId: string,
  html: string,
  baseUrl: string
): Promise<string> {
  console.log('[monolith] Getting sandbox for request:', requestId);
  const sandbox = getSandbox(env.Sandbox, requestId);

  // Write input HTML to workspace
  console.log('[monolith] Writing input HTML to sandbox...');
  await sandbox.writeFile('/workspace/in.html', html);

  // Build monolith command
  // monolith -b <base_url> [flags] /workspace/in.html -o /workspace/out.html
  const args = [
    ...MONOLITH_FLAGS,
    '-b',
    baseUrl,
    '/workspace/in.html',
    '-o',
    '/workspace/out.html'
  ];
  const command = `monolith ${args.join(' ')}`;

  console.log('[monolith] Executing:', command);
  const result = await sandbox.exec(command);

  if (!result.success) {
    console.error('[monolith] Execution failed:', {
      exitCode: result.exitCode,
      stderr: result.stderr,
      stdout: result.stdout
    });
    throw new Error(`Monolith failed (exit ${result.exitCode}): ${result.stderr}`);
  }

  console.log('[monolith] Execution complete, reading output...');
  const outputFile = await sandbox.readFile('/workspace/out.html');

  if (!outputFile.content) {
    throw new Error('Monolith produced empty output');
  }

  return outputFile.content;
}

/**
 * Call external monolith HTTP service as fallback.
 */
async function runMonolithViaHttp(
  serviceUrl: string,
  html: string,
  baseUrl: string
): Promise<string> {
  console.log('[monolith] Falling back to HTTP service:', serviceUrl);

  const response = await fetch(serviceUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, base_url: baseUrl })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Monolith HTTP service failed (${response.status}): ${text}`);
  }

  return response.text();
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (request.method !== 'POST' || url.pathname !== '/monolith') {
        return jsonResponse({ error: 'Not found' }, 404);
      }

      // Verify internal API key
      const apiKey = request.headers.get('X-Internal-API-Key');
      if (!apiKey || apiKey !== env.INTERNAL_API_KEY) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      // Parse request body
      let body: MonolithRequest;
      try {
        body = (await request.json()) as MonolithRequest;
      } catch {
        return jsonResponse({ error: 'Invalid JSON' }, 400);
      }

      const { request_id, rendered_html_key, base_url } = body;
      if (!request_id || !rendered_html_key || !base_url) {
        return jsonResponse(
          { error: 'Missing required fields: request_id, rendered_html_key, base_url' },
          400
        );
      }

      // Fetch HTML from R2
      console.log('[monolith] Fetching HTML from R2:', rendered_html_key);
      const htmlObject = await env.ARCHIVE_BUCKET.get(rendered_html_key);
      if (!htmlObject) {
        return jsonResponse(
          { error: 'HTML not found in R2', key: rendered_html_key },
          404
        );
      }

      const html = await htmlObject.text();
      console.log('[monolith] HTML fetched, length:', html.length);

      if (html.length < 100) {
        return jsonResponse(
          { error: 'HTML content too short', length: html.length },
          400
        );
      }

      // Try sandbox execution first, fall back to HTTP service if configured
      let monolithHtml: string;
      let method: 'sandbox' | 'http_fallback' = 'sandbox';
      const processingStart = Date.now();
      try {
        monolithHtml = await runMonolithInSandbox(env, request_id, html, base_url);
      } catch (sandboxError) {
        console.error('[monolith] Sandbox execution failed:', sandboxError);

        if (env.MONOLITH_SERVICE_URL) {
          console.log('[monolith] Trying HTTP fallback...');
          method = 'http_fallback';
          monolithHtml = await runMonolithViaHttp(env.MONOLITH_SERVICE_URL, html, base_url);
        } else {
          throw sandboxError;
        }
      }
      const processingMs = Date.now() - processingStart;

      console.log('[monolith] Monolith output length:', monolithHtml.length);

      // Store artifact to R2
      console.log('[monolith] Storing artifact to R2...');
      const data = new TextEncoder().encode(monolithHtml);
      const artifact = await storeArtifact(
        env.ARCHIVE_BUCKET,
        request_id,
        'monolith.html',
        data.buffer as ArrayBuffer,
        'text/html'
      );

      console.log('[monolith] Success!', { r2Key: artifact.r2Key, bytes: artifact.bytes });
      const response: MonolithSuccessResponse = {
        artifact,
        meta: { method, processingMs }
      };
      return jsonResponse(response);
    } catch (err) {
      console.error('[monolith] Unhandled error:', err);
      const errMsg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      return jsonResponse({ error: 'Internal error', message: errMsg, stack }, 500);
    }
  }
};
