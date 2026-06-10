import { getOptionsKey, timingSafeEqual, createEvent } from '@warg/shared';
import type {
  ArchiveOptions,
  LogEvent,
  InitRequestPayload
} from '@warg/shared';
import {
  generateRequestId,
  isValidArchiveUrl,
  isValidRequestId,
  withRequestId
} from './util.js';

const LOGGER_RETRY_ATTEMPTS = 3;
const ORPHAN_SWEEP_DEFAULT_LIMIT = 100;
const ORPHAN_SWEEP_DEFAULT_MIN_AGE_MS = 10 * 60 * 1000;
const ORPHAN_SWEEP_WORKFLOW_ATTEMPTS = 2;
// Leases older than this had their job finish long ago (P99 monolith wall time
// is ~3 min) — the workflow likely crashed before release(), so the container
// behind the lease may still be running.
// MUST be kept in sync with `LEASE_TTL_MS` in
// `warg/workers/workflow/src/BrowserQuotaDO.ts`.
// If this value is LOWER than LEASE_TTL_MS: sweep will stop containers under
// still-valid leases (premature kill).
// If this value is HIGHER than LEASE_TTL_MS: orphaned containers are missed
// until the excess gap elapses (delayed cleanup).
export const CONTAINER_SWEEP_MIN_LEASE_AGE_MS = 5 * 60 * 1000;

interface LoggerRequestRow {
  requestId?: string;
  url?: string;
  createdAt?: string;
  lastEventTs?: string | null;
  stage?: string | null;
}

interface LoggerRequestListResponse {
  requests?: LoggerRequestRow[];
}

interface OrphanQueuedCandidate {
  requestId: string;
  url: string;
  createdAt: string;
  optionsR2Key: string;
}

interface OrphanSweepOptions {
  limit?: number;
  minAgeMs?: number;
  dryRun?: boolean;
  source?: string;
}

interface OrphanSweepResult {
  source: string;
  dryRun: boolean;
  scanned: number;
  candidates: number;
  retriggered: number;
  markedFailed: number;
  skipped: number;
  failures: Array<{ requestId: string; error: string }>;
}

interface WorkflowStartAttemptResult {
  ok: boolean;
  status: number;
  body: string;
  workflowState?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore malformed JSON
  }
  return null;
}

/**
 * Make an internal request to the logger service.
 */
async function loggerRequest(
  env: Env,
  path: string,
  method: string,
  body?: unknown
): Promise<Response> {
  const url = `https://logger${path}`;
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-API-Key': env.INTERNAL_API_KEY
    }
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }
  return env.LOGGER.fetch(url, options);
}

/**
 * Make an internal request to logger with bounded retries, throwing on final failure.
 */
async function loggerRequestStrict(
  env: Env,
  path: string,
  method: string,
  body?: unknown
): Promise<Response> {
  let lastStatus = 0;
  let lastBody = '';
  let lastErrorMessage = '';

  for (let attempt = 0; attempt < LOGGER_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const response = await loggerRequest(env, path, method, body);
      if (response.ok) {
        return response;
      }

      lastStatus = response.status;
      lastBody = (await response.text()).slice(0, 600);

      if (!shouldRetryStatus(response.status) || attempt === LOGGER_RETRY_ATTEMPTS - 1) {
        break;
      }
      await sleep(100 * (2 ** attempt));
      continue;
    } catch (err) {
      lastStatus = 503;
      lastErrorMessage = err instanceof Error ? err.message : String(err);
      if (attempt === LOGGER_RETRY_ATTEMPTS - 1) {
        break;
      }
      await sleep(100 * (2 ** attempt));
    }
  }

  const detail = lastBody || lastErrorMessage || 'unknown logger error';
  throw new Error(`[gateway] Logger ${method} ${path} failed: ${lastStatus} ${detail}`);
}

/**
 * Initialize a request in the logger.
 */
async function initLoggerRequest(
  env: Env,
  payload: InitRequestPayload
): Promise<void> {
  await loggerRequestStrict(env, '/request/init', 'POST', payload);
}

/**
 * Append an event to the logger.
 */
async function appendLogEvent(
  env: Env,
  requestId: string,
  event: LogEvent
): Promise<void> {
  await loggerRequestStrict(env, '/event', 'POST', { requestId, event });
}

/**
 * Verify the public API key from the X-API-Key header.
 */
function verifyPublicApiKey(request: Request, env: Env): boolean {
  const apiKey = request.headers.get('X-API-Key');
  if (!apiKey) return false;
  return timingSafeEqual(apiKey, env.PUBLIC_API_KEY);
}

/**
 * Verify internal API key from X-Internal-API-Key header.
 */
function verifyInternalApiKey(request: Request, env: Env): boolean {
  const apiKey = request.headers.get('X-Internal-API-Key');
  if (!apiKey) return false;
  return timingSafeEqual(apiKey, env.INTERNAL_API_KEY);
}

async function fetchQueuedOrphanCandidates(
  env: Env,
  limit: number,
  minAgeMs: number
): Promise<{ scanned: number; candidates: OrphanQueuedCandidate[] }> {
  const safeLimit = Math.min(Math.max(limit, 1), 500);
  const safeMinAgeMs = Math.max(minAgeMs, 60_000);
  const response = await loggerRequestStrict(
    env,
    `/requests?status=queued&limit=${safeLimit}`,
    'GET'
  );
  const payload = (await response.json()) as LoggerRequestListResponse;
  const rows = Array.isArray(payload.requests) ? payload.requests : [];
  const nowMs = Date.now();
  const candidates: OrphanQueuedCandidate[] = [];

  for (const row of rows) {
    const requestId = typeof row.requestId === 'string' ? row.requestId : null;
    const url = typeof row.url === 'string' ? row.url : null;
    const createdAt =
      typeof row.createdAt === 'string' && row.createdAt.length > 0 ? row.createdAt : null;
    const hasLastEvent =
      typeof row.lastEventTs === 'string' && row.lastEventTs.trim().length > 0;
    const queuedStage = row.stage === 'queued' || row.stage == null;
    const createdAtMs = createdAt ? Date.parse(createdAt) : Number.NaN;
    const isOldEnough =
      Number.isFinite(createdAtMs) && nowMs - createdAtMs >= safeMinAgeMs;

    if (!requestId || !url || !createdAt) continue;
    if (!queuedStage || hasLastEvent || !isOldEnough) continue;

    candidates.push({
      requestId,
      url,
      createdAt,
      optionsR2Key: getOptionsKey(requestId)
    });
  }

  return { scanned: rows.length, candidates };
}

async function startWorkflowWithRetry(
  env: Env,
  candidate: OrphanQueuedCandidate
): Promise<WorkflowStartAttemptResult> {
  let lastStatus = 503;
  let lastBody = 'workflow start not attempted';
  let lastWorkflowState: string | undefined;

  for (let attempt = 0; attempt < ORPHAN_SWEEP_WORKFLOW_ATTEMPTS; attempt += 1) {
    try {
      const response = await env.WORKFLOW.fetch('https://workflow/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: candidate.requestId,
          url: candidate.url,
          options_r2_key: candidate.optionsR2Key
        })
      });

      const rawBody = (await response.text()).slice(0, 600);
      lastStatus = response.status;
      lastBody = rawBody;
      const parsed = parseJsonObject(rawBody);
      if (parsed && typeof parsed.status === 'string') {
        lastWorkflowState = parsed.status;
      }

      if (response.ok) {
        return {
          ok: true,
          status: response.status,
          body: rawBody,
          workflowState: lastWorkflowState
        };
      }

      if (!shouldRetryStatus(response.status) || attempt === ORPHAN_SWEEP_WORKFLOW_ATTEMPTS - 1) {
        break;
      }
      await sleep(250 * (2 ** attempt));
    } catch (err) {
      lastStatus = 503;
      lastBody = err instanceof Error ? err.message : String(err);
      if (attempt === ORPHAN_SWEEP_WORKFLOW_ATTEMPTS - 1) {
        break;
      }
      await sleep(250 * (2 ** attempt));
    }
  }

  return {
    ok: false,
    status: lastStatus,
    body: lastBody,
    workflowState: lastWorkflowState
  };
}

async function sweepQueuedOrphans(
  env: Env,
  options?: OrphanSweepOptions
): Promise<OrphanSweepResult> {
  const limit = options?.limit ?? ORPHAN_SWEEP_DEFAULT_LIMIT;
  const minAgeMs = options?.minAgeMs ?? ORPHAN_SWEEP_DEFAULT_MIN_AGE_MS;
  const source = options?.source ?? 'unknown';
  const dryRun = options?.dryRun === true;

  const discovered = await fetchQueuedOrphanCandidates(env, limit, minAgeMs);
  const summary: OrphanSweepResult = {
    source,
    dryRun,
    scanned: discovered.scanned,
    candidates: discovered.candidates.length,
    retriggered: 0,
    markedFailed: 0,
    skipped: 0,
    failures: []
  };

  if (dryRun) {
    summary.skipped = discovered.candidates.length;
    return summary;
  }

  for (const candidate of discovered.candidates) {
    try {
      const startResult = await startWorkflowWithRetry(env, candidate);
      if (startResult.ok) {
        await appendLogEvent(
          env,
          candidate.requestId,
          createEvent(
            'gateway',
            'workflow.started',
            'info',
            'Workflow start recovered by orphan queued sweep',
            {
              orphanSweep: true,
              workflowStatus: startResult.status,
              workflowState: startResult.workflowState ?? 'unknown',
              workflowBody: startResult.body
            }
          )
        );
        summary.retriggered += 1;
        continue;
      }

      await appendLogEvent(
        env,
        candidate.requestId,
        createEvent('gateway', 'workflow.trigger_failed', 'error', 'Failed to trigger workflow', {
          errorCode: 'WORKFLOW_TRIGGER_FAILED',
          retryable: true,
          recommendedAction: 'retry_full',
          orphanSweep: true,
          workflowStatus: startResult.status,
          workflowError: startResult.body
        })
      );
      await appendLogEvent(
        env,
        candidate.requestId,
        createEvent('gateway', 'request.failed', 'error', 'Request failed before workflow start', {
          errorCode: 'WORKFLOW_TRIGGER_FAILED',
          retryable: true,
          recommendedAction: 'retry_full',
          orphanSweep: true,
          workflowStatus: startResult.status,
          workflowError: startResult.body
        })
      );
      summary.markedFailed += 1;
    } catch (err) {
      summary.failures.push({
        requestId: candidate.requestId,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  return summary;
}

interface SandboxLeaseRow {
  leaseId?: string;
  requestId?: string;
  acquiredAt?: number;
}

export interface ContainerSweepResult {
  source: string;
  leases: number;
  stale: number;
  stopped: number;
  failures: Array<{ requestId: string; error: string }>;
}

/**
 * Stop monolith containers whose quota lease outlived the TTL — the third
 * lifecycle layer after the monolith worker's per-job stop() and the Sandbox
 * class's 5m sleepAfter backstop. Lists active sandbox leases from the
 * workflow worker and asks the monolith worker to stop each stale lease's
 * container. Best-effort: per-container failures are reported, not thrown.
 */
export async function sweepOrphanContainers(
  env: Env,
  source: string
): Promise<ContainerSweepResult> {
  const summary: ContainerSweepResult = {
    source,
    leases: 0,
    stale: 0,
    stopped: 0,
    failures: []
  };

  const response = await env.WORKFLOW.fetch('https://workflow/browser-quota/sandbox-leases', {
    headers: { 'X-Internal-API-Key': env.INTERNAL_API_KEY },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(`sandbox-leases fetch failed (${response.status}): ${body}`);
  }

  const raw: unknown = await response.json();
  if (
    raw === null ||
    typeof raw !== 'object' ||
    !Array.isArray((raw as Record<string, unknown>)['leases'])
  ) {
    console.warn('[gateway] container sweep: unexpected sandbox-leases payload shape, skipping', JSON.stringify(raw)?.slice(0, 300));
    return summary;
  }
  const leases = (raw as { leases: unknown[] }).leases.filter(
    (entry): entry is SandboxLeaseRow =>
      entry !== null &&
      typeof entry === 'object' &&
      ('requestId' in entry || 'acquiredAt' in entry)
  );
  summary.leases = leases.length;

  const now = Date.now();
  for (const lease of leases) {
    if (!lease.requestId || typeof lease.acquiredAt !== 'number') continue;
    if (now - lease.acquiredAt < CONTAINER_SWEEP_MIN_LEASE_AGE_MS) continue;
    summary.stale += 1;

    try {
      const stopResponse = await env.MONOLITH.fetch('https://monolith/container/stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-API-Key': env.INTERNAL_API_KEY
        },
        body: JSON.stringify({ request_id: lease.requestId }),
        signal: AbortSignal.timeout(10_000)
      });
      if (stopResponse.ok) {
        summary.stopped += 1;
      } else {
        const body = (await stopResponse.text()).slice(0, 300);
        summary.failures.push({
          requestId: lease.requestId,
          error: `stop failed (${stopResponse.status}): ${body}`
        });
      }
    } catch (err) {
      summary.failures.push({
        requestId: lease.requestId,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  return summary;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Public endpoints require X-API-Key authentication
    if (
      (method === 'POST' && path === '/begin') ||
      (method === 'GET' && path.startsWith('/status/'))
    ) {
      if (!verifyPublicApiKey(request, env)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    // POST /begin - Start a new archive request
    if (method === 'POST' && path === '/begin') {
      try {
        let body: ArchiveOptions & { request_id?: string };
        try {
          body = (await request.json()) as ArchiveOptions & { request_id?: string };
        } catch {
          return Response.json({ error: 'Invalid JSON' }, { status: 400 });
        }

        // Use client-provided request_id or generate one
        const requestId = body.request_id ?? generateRequestId();
        if (body.request_id && !isValidRequestId(requestId)) {
          return Response.json(
            { error: 'Invalid request_id format (UUID v4 or 1-40 char alphanumeric/hyphen/underscore required)' },
            { status: 400 }
          );
        }

        // Validate URL presence and format
        const urlError = !body.url
          ? 'url is required'
          : !isValidArchiveUrl(body.url)
            ? 'Invalid URL: only http and https URLs are supported'
            : undefined;

        if (urlError) {
          // We have a valid request_id — init logger so this failure is visible
          await initLoggerRequest(env, { requestId, url: body.url ?? '' });
          await appendLogEvent(
            env,
            requestId,
            createEvent('gateway', 'request.failed', 'error', urlError, {
              url: body.url,
              errorCode: 'INVALID_INPUT_URL',
              retryable: false,
              recommendedAction: 'inspect_url'
            })
          );
          return withRequestId(Response.json({ error: urlError }, { status: 400 }), requestId);
        }

        const optionsR2Key = getOptionsKey(requestId);

        // Extract options: remove request_id and strip fields that could enable script injection
        const { request_id: _, preScript: _ps, cleanupScript: _cs, ...options } = body as
          ArchiveOptions & { request_id?: string; preScript?: unknown; cleanupScript?: unknown };

        // Store options in R2
        await env.ARCHIVE_BUCKET.put(optionsR2Key, JSON.stringify(options), {
          httpMetadata: { contentType: 'application/json' }
        });

        // Initialize request in logger
        await initLoggerRequest(env, {
          requestId,
          url: options.url,
          optionsR2Key
        });

        // Append request.created event
        await appendLogEvent(
          env,
          requestId,
          createEvent('gateway', 'request.created', 'info', 'Archive request created', {
            url: options.url,
            optionsR2Key
          })
        );

        // Trigger workflow
        const workflowResponse = await env.WORKFLOW.fetch('https://workflow/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            request_id: requestId,
            url: options.url,
            options_r2_key: optionsR2Key
          })
        });

        if (!workflowResponse.ok) {
          const workflowStatus = workflowResponse.status;
          const workflowErrorBody = (await workflowResponse.text()).slice(0, 600);
          console.error('[gateway] Failed to trigger workflow:', workflowErrorBody);
          await appendLogEvent(
            env,
            requestId,
            createEvent('gateway', 'workflow.trigger_failed', 'error', 'Failed to trigger workflow', {
              errorCode: 'WORKFLOW_TRIGGER_FAILED',
              retryable: true,
              recommendedAction: 'retry_full',
              workflowStatus,
              workflowError: workflowErrorBody
            })
          );
          await appendLogEvent(
            env,
            requestId,
            createEvent('gateway', 'request.failed', 'error', 'Request failed before workflow start', {
              errorCode: 'WORKFLOW_TRIGGER_FAILED',
              retryable: true,
              recommendedAction: 'retry_full',
              workflowStatus,
              workflowError: workflowErrorBody
            })
          );
          // Return non-2xx so clients don't treat request creation as a successful start.
          return withRequestId(
            Response.json(
              {
                requestId,
                error: 'Workflow trigger failed',
                errorCode: 'WORKFLOW_TRIGGER_FAILED',
                workflowStatus,
                workflowError: workflowErrorBody
              },
              { status: 502 }
            ),
            requestId
          );
        }

        return withRequestId(Response.json({ requestId }, { status: 201 }), requestId);
      } catch (err) {
        console.error('[gateway] Error in /begin:', err);
        const errMsg = err instanceof Error ? err.message : String(err);
        return Response.json({ error: 'Internal error', message: errMsg }, { status: 500 });
      }
    }

    // GET /status/:id - Get request status
    if (method === 'GET' && path.startsWith('/status/')) {
      const requestId = path.slice('/status/'.length);
      if (!requestId) {
        return Response.json({ error: 'requestId is required' }, { status: 400 });
      }

      const response = await loggerRequest(env, `/request/${requestId}`, 'GET');
      return withRequestId(
        new Response(response.body, {
          status: response.status,
          headers: { 'Content-Type': 'application/json' }
        }),
        requestId
      );
    }

    // POST /internal/log - Forward event to logger (for external services)
    if (method === 'POST' && path === '/internal/log') {
      if (!verifyInternalApiKey(request, env)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }

      try {
        const body = (await request.json()) as { requestId: string; event: LogEvent };
        const response = await loggerRequest(env, '/event', 'POST', body);
        return withRequestId(
          new Response(response.body, {
            status: response.status,
            headers: { 'Content-Type': 'application/json' }
          }),
          body.requestId
        );
      } catch (err) {
        console.error('[gateway] Error in /internal/log:', err);
        const errMsg = err instanceof Error ? err.message : String(err);
        return Response.json({ error: 'Internal error', message: errMsg }, { status: 500 });
      }
    }

    // POST /internal/sweep-orphan-queued - retrigger queued requests that never emitted workflow events
    if (method === 'POST' && path === '/internal/sweep-orphan-queued') {
      if (!verifyInternalApiKey(request, env)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }

      try {
        const body = (await request
          .json()
          .catch(() => ({}))) as { limit?: number; minAgeMs?: number; dryRun?: boolean };
        const summary = await sweepQueuedOrphans(env, {
          limit: body.limit,
          minAgeMs: body.minAgeMs,
          dryRun: body.dryRun === true,
          source: 'manual'
        });
        return Response.json(summary);
      } catch (err) {
        console.error('[gateway] Error in /internal/sweep-orphan-queued:', err);
        const errMsg = err instanceof Error ? err.message : String(err);
        return Response.json({ error: 'Internal error', message: errMsg }, { status: 500 });
      }
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          const summary = await sweepQueuedOrphans(env, {
            source: `cron:${controller.cron ?? 'unknown'}`
          });
          if (summary.candidates > 0 || summary.failures.length > 0) {
            console.log('[gateway] orphan sweep summary:', JSON.stringify(summary));
          }
        } catch (err) {
          console.error('[gateway] orphan sweep failed:', err);
        }
      })()
    );
    ctx.waitUntil(
      (async () => {
        try {
          const summary = await sweepOrphanContainers(env, `cron:${controller.cron ?? 'unknown'}`);
          if (summary.failures.length > 0) {
            console.error('[gateway] container sweep partial failures:', JSON.stringify(summary));
          } else {
            console.log('[gateway] container sweep done:', JSON.stringify({ leases: summary.leases, stale: summary.stale, stopped: summary.stopped }));
          }
        } catch (err) {
          console.error('[gateway] container sweep failed:', err);
        }
      })()
    );
  }
};
