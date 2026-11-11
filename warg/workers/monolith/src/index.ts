import { getSandbox, Sandbox as BaseSandbox, ContainerUnavailableError } from '@cloudflare/sandbox';
import {
  classifySandboxOutput,
  readInternalJsonRequest,
  storeArtifact,
  type ArtifactMeta,
  type SandboxFailureCode
} from '@warg/shared';
import type { MonolithRequest, MonolithSuccessResponse } from './types.js';
import {
  buildCurlCommand,
  buildMonolithFileCommand,
  buildMonolithUrlCommand,
  buildUploadAndHashCommand,
  parseUploadOutput,
  SANDBOX_OUTPUT_PATH
} from './monolith-command.js';
import { handleR2Outbound, monolithKeys, R2_HANDLER_HOST, r2HandlerUrl } from './r2-outbound.js';

/**
 * Sandbox DO binding with a 5m `sleepAfter` backstop (the upstream default
 * is 10 minutes). The primary lifecycle mechanism is the explicit `stop()`
 * after each job in runMonolithInSandbox; this backstop reaps containers
 * whose stop() was missed (worker crash mid-job, stop() RPC failure) so they
 * cannot idle-bill DO duration. The value must exceed the longest job
 * (P99 ~180s) because the inactivity alarm fires even during an in-flight
 * exec (cloudflare/containers#162) — '5m' clears that tail with margin.
 * Wrangler's `containers` config exposes no sleep_after key, so the class
 * field is the configuration surface.
 */
export class Sandbox extends BaseSandbox {
  override sleepAfter: string | number = '5m';
}

/**
 * The container reaches R2 only through this handler, on one internal host,
 * against the Worker's own ARCHIVE_BUCKET binding. Every other host stays on
 * the container's own network.
 *
 * Registered by assignment, not as a `static` class field: the build targets
 * ES2022, whose class fields define a new property that would hide the base
 * class's setter and leave the handler unregistered. It is static on purpose:
 * a runtime override (`setOutboundByHost`) switches the container to
 * intercepting every host.
 */
Sandbox.outboundByHost = {
  [R2_HANDLER_HOST]: (request, env, ctx) =>
    handleR2Outbound(request, {
      bucket: env.ARCHIVE_BUCKET,
      containerId: ctx.containerId,
      containerIdForRequest: id => env.Sandbox.idFromName(normalizeSandboxId(id)).toString(),
      knownLength: (body, bytes) => body.pipeThrough(new FixedLengthStream(bytes))
    })
};

// The platform hands intercepted container requests to this entrypoint.
export { ContainerProxy } from '@cloudflare/sandbox';

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

/**
 * The sandbox container is not ready yet. Answered with 503 and retryable: the
 * job fails at once instead of waiting here, and the workflow step's retry
 * delay does the waiting before the next attempt.
 */
function containerUnavailableError(retryAfterMs: number): MonolithServiceError {
  return new MonolithServiceError(
    `Sandbox container not ready (retry after ${retryAfterMs} ms)`,
    'MONOLITH_CONTAINER_UNAVAILABLE',
    503,
    true
  );
}

const SANDBOX_FAILURE_MESSAGES: Record<
  Exclude<SandboxFailureCode, 'MONOLITH_SANDBOX_500' | 'MONOLITH_R2_HANDLER_FAILED'>,
  string
> = {
  MONOLITH_RPC_32MIB_LIMIT: 'Monolith sandbox payload exceeded RPC size limit',
  MONOLITH_TIMEOUT: 'Sandbox timed out while processing monolith output'
};

function classifySandboxFailure(stderr: string, stdout: string): MonolithServiceError {
  const { errorCode, retryable, handlerStatus } = classifySandboxOutput(stderr, stdout);
  if (errorCode === 'MONOLITH_R2_HANDLER_FAILED') {
    // The Worker's own R2 handler refused or failed the container's request:
    // answered 502 so it is not read as a monolith crash.
    return new MonolithServiceError(
      `R2 handler answered ${handlerStatus ?? 'an error'}: ${stderr || stdout}`,
      errorCode,
      502,
      retryable
    );
  }
  const message =
    errorCode === 'MONOLITH_SANDBOX_500'
      ? `Sandbox execution failed: ${stderr || stdout || 'unknown sandbox error'}`
      : SANDBOX_FAILURE_MESSAGES[errorCode];
  return new MonolithServiceError(message, errorCode, 500, retryable);
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

/**
 * Run one command in the sandbox. A container that is not ready
 * (ContainerUnavailableError with its retry hint) fails the job retryable at
 * any exec: no fallback can reach a container that is not there, and the
 * workflow step's retry delay does the waiting.
 */
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
    const retryAfterMs = error instanceof ContainerUnavailableError ? error.retryAfterMs : undefined;
    if (retryAfterMs !== undefined) {
      console.warn('[monolith] ContainerUnavailableError: container not ready', { retryAfterMs, message });
      throw containerUnavailableError(retryAfterMs);
    }
    return { success: false, exitCode: -1, stdout: '', stderr: `Sandbox exec failed: ${message}` };
  }
}

/**
 * Execute monolith in the sandbox and return processed HTML.
 *
 * The container reads its input from, and writes its output to, the Worker's
 * R2 handler host — monolith fetches the input URL directly. If that fails (e.g. monolith's
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
  // The R2 handler serves only this request's deterministic keys, so any other
  // input key would be refused inside the container; refuse it here instead.
  const keys = monolithKeys(requestId);
  if (renderedHtmlKey !== keys.input) {
    throw new MonolithServiceError(
      `rendered_html_key must be ${keys.input}`,
      'INVALID_INPUT_KEY',
      400,
      false
    );
  }
  const sandboxId = normalizeSandboxId(requestId);
  console.log('[monolith] Getting sandbox for request:', requestId, 'sandbox:', sandboxId);
  const sandbox = getSandbox(env.Sandbox, sandboxId, { transport: 'rpc' });

  try {
    // Retry attempts can land on the same per-request container within the
    // sleepAfter window, so clear any prior output before this run. Folded
    // into the exec strings (no extra RPC); monolith's `-o` also truncates,
    // this just closes the success-but-stale edge.
    const cleanOut = `rm -f ${SANDBOX_OUTPUT_PATH}`;

    // The rendered HTML, served by the Worker's R2 handler.
    const documentUrl = r2HandlerUrl(keys.input);

    // Primary: monolith fetches the URL directly (no curl dependency).
    console.log('[monolith] Executing monolith via R2 handler fetch...');
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
        // When curl names an R2 handler answer, that says more than monolith's own failure.
        const curlFailure = classifySandboxFailure(curl.stderr, curl.stdout);
        if (curlFailure.code === 'MONOLITH_R2_HANDLER_FAILED') throw curlFailure;
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

    // Upload the output to R2 through the Worker's R2 handler, then read back its
    // sha256 + byte size from stdout. Routing the bytes over the container network
    // sidesteps the 32 MiB `readFile` RPC ceiling that heavy (base64-inlined)
    // pages would otherwise overflow.
    console.log('[monolith] Execution complete, uploading output to R2...');
    const r2Key = keys.output;
    const putUrl = r2HandlerUrl(r2Key);
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
    // throw. A failed stop() must not mask the job's own outcome — the 5m
    // sleepAfter backstop and the browser quota object's stale-lease stop cover
    // missed stops.
    try {
      await sandbox.stop();
    } catch (stopErr) {
      console.warn(`[monolith] stop() failed for ${requestId} (sandbox: ${sandboxId}) — non-fatal, sleepAfter backstop covers:`, stopErr);
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
      const pre = await readInternalJsonRequest(request, env.INTERNAL_API_KEY, ['/monolith', '/container/stop']);
      if (!pre.ok) return pre.response;

      // POST /container/stop - stop a request's container (the workflow's browser quota
      // object calls it when a sandbox lease goes stale)
      if (pre.url.pathname === '/container/stop') {
        // The caller's request shape; its required field is checked below.
        const stopBody = pre.body as { request_id?: string };
        if (!stopBody.request_id) {
          return Response.json({ error: 'Missing required field: request_id' }, { status: 400 });
        }
        const sandboxId = normalizeSandboxId(stopBody.request_id);
        try {
          await getSandbox(env.Sandbox, sandboxId, { transport: 'rpc' }).stop();
          console.log('[monolith] Stopped container via /container/stop:', sandboxId);
        } catch (stopErr) {
          // Primary: ContainerUnavailableError is the structured signal that the container
          // cannot accept the stop RPC — which covers both "never started" and "already stopped"
          // (neither has a container running to receive the call).
          if (stopErr instanceof ContainerUnavailableError) {
            console.log('[monolith] /container/stop benign (container unavailable — already stopped or never started):', sandboxId, 'request_id:', stopBody.request_id);
            return Response.json({ ok: true, note: 'container already stopped or never started' });
          }
          // Fallback: message-text heuristic for non-SandboxError platform throws.
          const msg = stopErr instanceof Error ? stopErr.message : String(stopErr);
          if (/not found|already stopped|no container|does not exist|not running/i.test(msg)) {
            console.log('[monolith] /container/stop benign (container already stopped or never started):', sandboxId, 'request_id:', stopBody.request_id);
            return Response.json({ ok: true, note: 'container already stopped or never started' });
          }
          throw stopErr;
        }
        return Response.json({ ok: true });
      }

      // The caller's request shape; its required fields are checked below.
      const body = pre.body as MonolithRequest;

      const { request_id, rendered_html_key, base_url } = body;
      if (!request_id || !rendered_html_key || !base_url) {
        return Response.json(
          { error: 'Missing required fields: request_id, rendered_html_key, base_url' },
          { status: 400 }
        );
      }

      // Validate the rendered HTML exists in R2 without reading it into the
      // worker — the Sandbox fetches it through the Worker's R2 handler.
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
