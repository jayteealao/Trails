import { getSandbox, Sandbox as BaseSandbox } from '@cloudflare/sandbox';
import { getR2Key, storeArtifact, timingSafeEqual, type ArtifactMeta } from '@warg/shared';
import type { MonolithRequest, MonolithSuccessResponse } from './types.js';
import {
  buildCurlCommand,
  buildMonolithFileCommand,
  buildMonolithUrlCommand,
  buildUploadAndHashCommand,
  parseUploadOutput,
  SANDBOX_OUTPUT_PATH
} from './monolith-command.js';
import { presignR2GetUrl, presignR2PutUrl, type R2PresignConfig } from './r2-presign.js';
import { isRpc32MiBLimit } from './failure-classify.js';

/**
 * Sandbox DO binding with a 30s `sleepAfter` backstop (the upstream default
 * is 10 minutes). The primary lifecycle mechanism is the explicit `stop()`
 * after each job in runMonolithInSandbox; this backstop reaps containers
 * whose stop() was missed (worker crash mid-job, stop() RPC failure) so they
 * cannot idle-bill DO duration. Wrangler's `containers` config exposes no
 * sleep_after key, so the class field is the configuration surface.
 */
export class Sandbox extends BaseSandbox {
  override sleepAfter: string | number = '30s';
}

class MonolithServiceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(message: string, code: string, status: number, retryable: boolean) {
    super(message);
    this.name = 'MonolithServiceError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function shortDeterministicHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Sandbox IDs have stricter constraints than request IDs.
 * Keep request_id unchanged for artifact keys/joins and normalize a separate sandbox id.
 */
function normalizeSandboxId(requestId: string): string {
  const lower = requestId.trim().toLowerCase();
  const sanitized = lower.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  const prefixed = /^[a-z]/.test(sanitized) ? sanitized : `s-${sanitized || 'request'}`;

  // Keep room for deterministic hash suffix when truncating.
  if (prefixed.length <= 63) return prefixed;

  const suffix = shortDeterministicHash(requestId);
  const maxBaseLength = 63 - suffix.length - 1;
  const base = prefixed.slice(0, Math.max(1, maxBaseLength)).replace(/-+$/g, '');
  return `${base}-${suffix}`;
}

function classifySandboxFailure(stderr: string, stdout: string): MonolithServiceError {
  const message = `${stderr}\n${stdout}`.toLowerCase();

  if (isRpc32MiBLimit(message)) {
    return new MonolithServiceError(
      'Monolith sandbox payload exceeded RPC size limit',
      'MONOLITH_RPC_32MIB_LIMIT',
      500,
      false
    );
  }

  if (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('deadline exceeded')
  ) {
    return new MonolithServiceError(
      'Sandbox timed out while processing monolith output',
      'MONOLITH_TIMEOUT',
      500,
      true
    );
  }

  return new MonolithServiceError(
    `Sandbox execution failed: ${stderr || stdout || 'unknown sandbox error'}`,
    'MONOLITH_SANDBOX_500',
    500,
    true
  );
}

function isRetryableSandboxError(error: unknown): boolean {
  if (!(error instanceof MonolithServiceError)) return true;
  return error.retryable;
}

/**
 * Validate and normalize base_url.
 */
function validateBaseUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new MonolithServiceError('Invalid base_url', 'INVALID_INPUT_URL', 400, false);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new MonolithServiceError('base_url must be http or https', 'INVALID_INPUT_URL', 400, false);
  }
  // eslint-disable-next-line no-control-regex -- rejecting control chars in URLs is the point
  if (/[\u0000-\u001F\u007F]/.test(url)) {
    throw new MonolithServiceError(
      'base_url contains invalid characters',
      'INVALID_INPUT_URL',
      400,
      false
    );
  }
  return parsed.toString();
}

/**
 * Normalized result of a single sandbox exec. Exec RPC failures are folded into
 * a failed outcome (not thrown) so the caller can attempt the curl fallback.
 */
interface ExecOutcome {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

type SandboxHandle = ReturnType<typeof getSandbox>;

async function execInSandbox(sandbox: SandboxHandle, command: string): Promise<ExecOutcome> {
  try {
    const result = await sandbox.exec(command);
    return {
      success: result.success,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, exitCode: -1, stdout: '', stderr: `Sandbox exec failed: ${message}` };
  }
}

/**
 * Assemble + validate the R2 presign config from worker secrets.
 * Throws a clear, non-retryable config error if any secret is missing.
 */
function getPresignConfig(env: Env): R2PresignConfig {
  const { R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID, R2_BUCKET_NAME } = env;
  if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ACCOUNT_ID || !R2_BUCKET_NAME) {
    throw new MonolithServiceError(
      'R2 presign not configured (need R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID, R2_BUCKET_NAME)',
      'MONOLITH_CONFIG',
      500,
      false
    );
  }
  return {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    accountId: R2_ACCOUNT_ID,
    bucket: R2_BUCKET_NAME
  };
}

/**
 * Execute monolith in the sandbox and return processed HTML.
 *
 * Input is delivered over the container's own network via a presigned R2 GET
 * URL (B1b) — monolith fetches it directly. If that fails (e.g. monolith's
 * URL-fetch or `-b` override misbehaves), fall back to `curl`-to-file, which
 * writes inside the container (normal fs) and feeds monolith a local path.
 * Neither path uses the host→container `writeFile` RPC that was 500ing.
 */
export async function runMonolithInSandbox(
  env: Env,
  requestId: string,
  renderedHtmlKey: string,
  baseUrl: string
): Promise<{ artifact: ArtifactMeta; sandboxId: string }> {
  const normalizedBaseUrl = validateBaseUrl(baseUrl);
  const sandboxId = normalizeSandboxId(requestId);
  console.log('[monolith] Getting sandbox for request:', requestId, 'sandbox:', sandboxId);
  const sandbox = getSandbox(env.Sandbox, sandboxId);

  try {
    // Retry attempts can land on the same per-request container within the
    // sleepAfter window, so clear any prior output before this run. Folded
    // into the exec strings (no extra RPC); monolith's `-o` also truncates,
    // this just closes the success-but-stale edge.
    const cleanOut = `rm -f ${SANDBOX_OUTPUT_PATH}`;

    // Mint a short-lived presigned GET URL for the rendered HTML. Never logged —
    // it grants read access to the object for its TTL.
    const documentUrl = await presignR2GetUrl(getPresignConfig(env), renderedHtmlKey);

    // Primary: monolith fetches the URL directly (no curl dependency).
    console.log('[monolith] Executing monolith via presigned URL fetch...');
    let result = await execInSandbox(
      sandbox,
      `${cleanOut}; ${buildMonolithUrlCommand(documentUrl, normalizedBaseUrl)}`
    );

    // Fallback: curl the URL into a local file, then monolith reads the file.
    if (!result.success) {
      console.warn('[monolith] URL-fetch path failed, trying curl-to-file fallback', {
        exitCode: result.exitCode,
        stderr: result.stderr.slice(0, 500)
      });
      const curl = await execInSandbox(sandbox, buildCurlCommand(documentUrl));
      if (curl.success) {
        result = await execInSandbox(
          sandbox,
          `${cleanOut}; ${buildMonolithFileCommand(normalizedBaseUrl)}`
        );
      } else {
        console.error('[monolith] curl fallback failed', {
          exitCode: curl.exitCode,
          stderr: curl.stderr.slice(0, 500)
        });
      }
    }

    if (!result.success) {
      console.error('[monolith] Execution failed:', {
        exitCode: result.exitCode,
        stderr: result.stderr,
        stdout: result.stdout
      });
      throw classifySandboxFailure(result.stderr, result.stdout);
    }

    // Upload the output straight to R2 via a presigned PUT URL, then read back its
    // sha256 + byte size from stdout. Routing the bytes over the container network
    // sidesteps the 32 MiB `readFile` RPC ceiling that heavy (base64-inlined)
    // pages would otherwise overflow.
    console.log('[monolith] Execution complete, uploading output to R2...');
    const r2Key = getR2Key(requestId, 'monolith.html');
    const putUrl = await presignR2PutUrl(getPresignConfig(env), r2Key);
    const upload = await execInSandbox(sandbox, buildUploadAndHashCommand(putUrl));
    if (!upload.success) {
      console.error('[monolith] Output upload failed:', {
        exitCode: upload.exitCode,
        stderr: upload.stderr.slice(0, 500)
      });
      throw classifySandboxFailure(upload.stderr, upload.stdout);
    }

    const parsed = parseUploadOutput(upload.stdout);
    if (!parsed) {
      throw new MonolithServiceError(
        'Monolith output upload did not report sha256/size',
        'MONOLITH_SANDBOX_500',
        500,
        true
      );
    }
    if (parsed.bytes === 0) {
      throw new MonolithServiceError(
        'Monolith produced empty output',
        'MONOLITH_EMPTY_OUTPUT',
        500,
        false
      );
    }

    const artifact: ArtifactMeta = {
      kind: 'monolith.html',
      r2Key,
      bytes: parsed.bytes,
      sha256: parsed.sha256,
      contentType: 'text/html'
    };
    return { artifact, sandboxId };
  } finally {
    // Containers bill DO duration while alive: stop per job, on success AND
    // throw. A failed stop() must not mask the job's own outcome — the 30s
    // sleepAfter backstop and the cron orphan sweep cover missed stops.
    try {
      await sandbox.stop();
    } catch (stopErr) {
      console.warn('[monolith] stop() failed (non-fatal):', stopErr);
    }
  }
}

/**
 * Call external monolith HTTP service as fallback.
 */
async function runMonolithViaHttp(
  serviceUrl: string,
  html: string,
  baseUrl: string,
  apiKey: string
): Promise<string> {
  console.log('[monolith] Falling back to HTTP service:', serviceUrl);

  const response = await fetch(serviceUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-API-Key': apiKey
    },
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

      const isKnownRoute =
        request.method === 'POST' &&
        (url.pathname === '/monolith' || url.pathname === '/container/stop');
      if (!isKnownRoute) {
        return Response.json({ error: 'Not found' }, { status: 404 });
      }

      // Verify internal API key
      const apiKey = request.headers.get('X-Internal-API-Key');
      if (!apiKey || !timingSafeEqual(apiKey, env.INTERNAL_API_KEY)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }

      // POST /container/stop - stop a request's container (gateway orphan sweep)
      if (url.pathname === '/container/stop') {
        let stopBody: { request_id?: string };
        try {
          stopBody = (await request.json()) as { request_id?: string };
        } catch {
          return Response.json({ error: 'Invalid JSON' }, { status: 400 });
        }
        if (!stopBody.request_id) {
          return Response.json({ error: 'Missing required field: request_id' }, { status: 400 });
        }
        const sandboxId = normalizeSandboxId(stopBody.request_id);
        await getSandbox(env.Sandbox, sandboxId).stop();
        console.log('[monolith] Stopped container via /container/stop:', sandboxId);
        return Response.json({ ok: true, sandboxId });
      }

      // Parse request body
      let body: MonolithRequest;
      try {
        body = (await request.json()) as MonolithRequest;
      } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 });
      }

      const { request_id, rendered_html_key, base_url } = body;
      if (!request_id || !rendered_html_key || !base_url) {
        return Response.json(
          { error: 'Missing required fields: request_id, rendered_html_key, base_url' },
          { status: 400 }
        );
      }

      // Validate the rendered HTML exists in R2 without reading it into the
      // worker — the Sandbox fetches it directly via a presigned URL.
      const htmlHead = await env.ARCHIVE_BUCKET.head(rendered_html_key);
      if (!htmlHead) {
        return Response.json(
          { error: 'HTML not found in R2', key: rendered_html_key },
          { status: 404 }
        );
      }
      if (htmlHead.size < 100) {
        return Response.json(
          { error: 'HTML content too short', length: htmlHead.size },
          { status: 400 }
        );
      }
      console.log('[monolith] Rendered HTML present:', rendered_html_key, 'bytes:', htmlHead.size);

      // Try sandbox execution first, fall back to HTTP service if configured.
      // The sandbox path uploads its output to R2 directly and returns artifact
      // metadata; the HTTP fallback returns HTML that we store here.
      let artifact: ArtifactMeta;
      let sandboxId: string | undefined;
      let method: 'sandbox' | 'http_fallback' = 'sandbox';
      const processingStart = Date.now();
      try {
        const sandboxResult = await runMonolithInSandbox(
          env,
          request_id,
          rendered_html_key,
          base_url
        );
        artifact = sandboxResult.artifact;
        sandboxId = sandboxResult.sandboxId;
      } catch (sandboxError) {
        console.error('[monolith] Sandbox execution failed:', sandboxError);

        if (env.MONOLITH_SERVICE_URL && isRetryableSandboxError(sandboxError)) {
          console.log('[monolith] Trying HTTP fallback...');
          method = 'http_fallback';
          const htmlObject = await env.ARCHIVE_BUCKET.get(rendered_html_key);
          if (!htmlObject) {
            throw sandboxError;
          }
          const html = await htmlObject.text();
          const monolithHtml = await runMonolithViaHttp(env.MONOLITH_SERVICE_URL, html, base_url, env.INTERNAL_API_KEY);
          const data = new TextEncoder().encode(monolithHtml);
          artifact = await storeArtifact(
            env.ARCHIVE_BUCKET,
            request_id,
            'monolith.html',
            data.buffer as ArrayBuffer,
            'text/html'
          );
        } else {
          throw sandboxError;
        }
      }
      const processingMs = Date.now() - processingStart;

      console.log('[monolith] Success!', { r2Key: artifact.r2Key, bytes: artifact.bytes, method });
      const response: MonolithSuccessResponse = {
        artifact,
        meta: {
          method,
          processingMs,
          ...(sandboxId ? { sandboxId } : {})
        }
      };
      return Response.json(response);
    } catch (err) {
      console.error('[monolith] Unhandled error:', err);
      if (err instanceof MonolithServiceError) {
        return Response.json(
          {
            error: err.status >= 500 ? 'Internal error' : 'Invalid input',
            message: err.message,
            code: err.code,
            retryable: err.retryable,
          },
          { status: err.status }
        );
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      return Response.json(
        { error: 'Internal error', message: errMsg, code: 'MONOLITH_UNHANDLED' },
        { status: 500 }
      );
    }
  }
};
