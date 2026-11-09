import { getOptionsKey, timingSafeEqual, createEvent } from '@warg/shared';
import type {
  LogEvent,
  InitRequestPayload
} from '@warg/shared';
import { generateRequestId, isValidArchiveUrl, isValidRequestId, withRequestId } from './util.js';
import { GATEWAY_ERROR_CODES, INTERNAL_ERROR_MESSAGE, errorIdFor, errorResponse, type GatewayErrorCode } from './errors.js';
import { MAX_BEGIN_BODY_BYTES, MAX_LOGGED_KEY_LENGTH, isPlainObject, PUBLIC_ONLY_FORBIDDEN_OPTION_KEYS, validateArchiveOptions } from './archive-options.js';
import { REQUEST_OWNER_METADATA_KEY, resolveRequestIdOwner, storedRequestIdOwner, type CallerKind } from './request-owner.js';
import { PUBLIC_STATUS_STREAM_MAX_MS, capEventStream } from './event-stream.js';

const LOGGER_RETRY_ATTEMPTS = 3;
const ORPHAN_SWEEP_DEFAULT_LIMIT = 100;
const ORPHAN_SWEEP_DEFAULT_MIN_AGE_MS = 10 * 60 * 1000;
const ORPHAN_SWEEP_WORKFLOW_ATTEMPTS = 2;
const ORPHAN_SWEEP_MAX_PAGES = 5;

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
/**
 * The outcome of the owner check of a request id: the owner to record and the condition the options
 * write must meet, or the owner that refuses the caller.
 */
type RequestIdClaim = { ok: true; owner: string; onlyIf?: R2Conditional } | { ok: false; storedOwner: string };

/**
 * Read the stored owner of a client-chosen request id and decide whether the caller may run it.
 * The returned condition makes the options write apply only over the object this decision read,
 * or only while there is still none.
 */
async function claimRequestId(bucket: R2Bucket, optionsR2Key: string, caller: CallerKind): Promise<RequestIdClaim> {
  const existing = await bucket.head(optionsR2Key);
  const ownership = resolveRequestIdOwner(storedRequestIdOwner(existing), caller);
  if (!ownership.ok) {
    return ownership;
  }
  return {
    ok: true,
    owner: ownership.owner,
    onlyIf: existing ? { etagMatches: existing.etag } : { etagDoesNotMatch: '*' }
  };
}

/**
 * Write the options object with its owner. Returns false when the claim's condition no longer holds
 * (another caller wrote the object after the owner check).
 */
async function storeOptions(
  bucket: R2Bucket,
  optionsR2Key: string,
  body: string,
  claim: { owner: string; onlyIf?: R2Conditional }
): Promise<boolean> {
  const options: R2PutOptions = {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { [REQUEST_OWNER_METADATA_KEY]: claim.owner }
  };
  if (!claim.onlyIf) {
    await bucket.put(optionsR2Key, body, options);
    return true;
  }
  const written = await bucket.put(optionsR2Key, body, { ...options, onlyIf: claim.onlyIf });
  return written !== null;
}

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

/**
 * Read the queued rows the orphan sweep may retrigger, oldest stuck rows first.
 *
 * The logger returns only queued rows with no event that are older than the cutoff, oldest
 * first, so a burst of young rows cannot hide the stuck ones. The gateway still drops rows it
 * cannot start (no id or url), so it pages, up to ORPHAN_SWEEP_MAX_PAGES pages. Every page is
 * read before any retrigger, so the sweep's own writes do not shift the offsets.
 */
async function fetchQueuedOrphanCandidates(
  env: Env,
  limit: number,
  minAgeMs: number
): Promise<{ scanned: number; candidates: OrphanQueuedCandidate[] }> {
  const safeLimit = Math.min(Math.max(limit, 1), 500);
  const safeMinAgeMs = Math.max(minAgeMs, 60_000);
  const nowMs = Date.now();
  const cutoffIso = new Date(nowMs - safeMinAgeMs).toISOString();
  const candidates: OrphanQueuedCandidate[] = [];
  let scanned = 0;

  for (let page = 0; page < ORPHAN_SWEEP_MAX_PAGES; page += 1) {
    const query = new URLSearchParams({
      status: 'queued',
      events: 'none',
      to: cutoffIso,
      order: 'asc',
      limit: String(safeLimit),
      offset: String(page * safeLimit)
    });
    const response = await loggerRequestStrict(env, `/requests?${query.toString()}`, 'GET');
    const payload = (await response.json()) as LoggerRequestListResponse;
    const rows = Array.isArray(payload.requests) ? payload.requests : [];
    scanned += rows.length;

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
      // Defence in depth: the logger's list query already returns only queued rows with
      // no event, older than the cut-off. These checks keep a row out if that query or
      // its answer drifts; the query is the definition of an orphan row.
      if (!queuedStage || hasLastEvent || !isOldEnough) continue;

      candidates.push({
        requestId,
        url,
        createdAt,
        optionsR2Key: getOptionsKey(requestId)
      });
    }

    if (rows.length < safeLimit || candidates.length >= safeLimit) break;
  }

  return { scanned, candidates: candidates.slice(0, safeLimit) };
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

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // /begin takes the internal key (checked first, so a caller sending both is internal) or the public key;
    // /status/* takes the public key.
    let callerKind: CallerKind = 'public';
    if (method === 'POST' && path === '/begin') {
      if (verifyInternalApiKey(request, env)) {
        callerKind = 'internal';
      } else if (!verifyPublicApiKey(request, env)) {
        return errorResponse(401, GATEWAY_ERROR_CODES.UNAUTHORIZED, 'Unauthorized', errorIdFor(undefined));
      }
    } else if (method === 'GET' && path.startsWith('/status/')) {
      if (!verifyPublicApiKey(request, env)) {
        return errorResponse(401, GATEWAY_ERROR_CODES.UNAUTHORIZED, 'Unauthorized', errorIdFor(undefined));
      }
    }

    // POST /begin - Start a new archive request
    if (method === 'POST' && path === '/begin') {
      // The id of an error response: a fresh correlation id until the request id is known and valid.
      let errorId = errorIdFor(undefined);
      // A refused /begin leaves a log line naming the code, so a caller's rejected starts can be traced.
      const refuseBegin = (status: number, code: GatewayErrorCode, message: string): Response => {
        console.warn('[gateway] /begin refused', { id: errorId, status, code, caller: callerKind });
        return errorResponse(status, code, message, errorId);
      };
      try {
        const tooLargeMessage = `Request body exceeds ${MAX_BEGIN_BODY_BYTES} bytes`;
        if (Number(request.headers.get('content-length') ?? 0) > MAX_BEGIN_BODY_BYTES) {
          return refuseBegin(413, GATEWAY_ERROR_CODES.INVALID_OPTIONS, tooLargeMessage);
        }
        // Read the body as text and bound it before parsing: a body without a declared length is checked here.
        const bodyText = await request.text();
        if (new TextEncoder().encode(bodyText).byteLength > MAX_BEGIN_BODY_BYTES) {
          return refuseBegin(413, GATEWAY_ERROR_CODES.INVALID_OPTIONS, tooLargeMessage);
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(bodyText);
        } catch {
          return refuseBegin(400, GATEWAY_ERROR_CODES.INVALID_JSON, 'Invalid JSON');
        }

        if (!isPlainObject(parsed)) {
          return refuseBegin(400, GATEWAY_ERROR_CODES.INVALID_OPTIONS, 'Request body must be a JSON object');
        }

        // Take out the request id and the script fields (stripped: they could enable script injection);
        // the rest are the archive options.
        const { request_id: rawRequestId, preScript: _ps, cleanupScript: _cs, ...fields } = parsed;

        // Use client-provided request_id or generate one
        const invalidRequestIdMessage =
          'Invalid request_id format (UUID v4 or 1-40 char alphanumeric/hyphen/underscore required)';
        // A present id (an empty string too) must be a valid one; only an absent or null id is generated.
        const clientChoseRequestId = rawRequestId !== undefined && rawRequestId !== null;
        if (clientChoseRequestId && (typeof rawRequestId !== 'string' || !isValidRequestId(rawRequestId))) {
          return refuseBegin(400, GATEWAY_ERROR_CODES.INVALID_REQUEST_ID, invalidRequestIdMessage);
        }
        const requestId = typeof rawRequestId === 'string' ? rawRequestId : generateRequestId();
        errorId = requestId;

        // Check the option types before anything is stored
        const validation = validateArchiveOptions(fields);
        if (!validation.ok) {
          return refuseBegin(400, GATEWAY_ERROR_CODES.INVALID_OPTIONS, validation.message);
        }
        // Only the internal key may choose a dry run or the step list
        if (callerKind === 'public') {
          const forbiddenKey = PUBLIC_ONLY_FORBIDDEN_OPTION_KEYS.find((key) => fields[key] !== undefined);
          if (forbiddenKey) {
            return refuseBegin(
              403,
              GATEWAY_ERROR_CODES.OPTION_NOT_ALLOWED,
              `${forbiddenKey} is not allowed with the public key`
            );
          }
        }
        if (validation.droppedKeys.length > 0) {
          // Key names are caller text: log a bounded number of them, each cut to a bounded length.
          console.warn('[gateway] /begin dropped unknown option keys', {
            id: requestId,
            count: validation.droppedKeys.length,
            keys: validation.droppedKeys.slice(0, 20).map((key) => key.slice(0, MAX_LOGGED_KEY_LENGTH))
          });
        }

        // A client-chosen id may be run again only by the caller that first started it, or the internal key.
        // Checked before anything is logged, stored or started.
        const optionsR2Key = getOptionsKey(requestId);
        const refuseRequestId = (storedOwner: string): Response => {
          console.warn('[gateway] /begin refused a request id owned by another caller', {
            id: requestId,
            owner: storedOwner,
            caller: callerKind
          });
          return errorResponse(
            409,
            GATEWAY_ERROR_CODES.REQUEST_ID_CONFLICT,
            'request_id is already in use by another caller',
            requestId
          );
        };
        // A generated id is new by construction: it is written without a lookup or a condition.
        let claim: RequestIdClaim = { ok: true, owner: callerKind };
        if (clientChoseRequestId) {
          claim = await claimRequestId(env.ARCHIVE_BUCKET, optionsR2Key, callerKind);
          if (!claim.ok) {
            return refuseRequestId(claim.storedOwner);
          }
        }

        // Validate URL presence and format
        const url = validation.options.url;
        if (!url || !isValidArchiveUrl(url)) {
          const urlError = !url ? 'url is required' : 'Invalid URL: only http and https URLs are supported';
          // We have a valid request_id — init logger so this failure is visible
          await initLoggerRequest(env, { requestId, url: url ?? '' });
          await appendLogEvent(
            env,
            requestId,
            createEvent('gateway', 'request.failed', 'error', urlError, {
              url,
              errorCode: 'INVALID_INPUT_URL',
              retryable: false,
              recommendedAction: 'inspect_url'
            })
          );
          return errorResponse(400, GATEWAY_ERROR_CODES.INVALID_INPUT_URL, urlError, requestId);
        }

        // Store options in R2, with the owner of the request id. The write is conditional on the object the
        // owner decision read, so a caller that wrote it in between is seen: decide again on what it wrote.
        const optionsBody = JSON.stringify(validation.options);
        let storedOptions = await storeOptions(env.ARCHIVE_BUCKET, optionsR2Key, optionsBody, claim);
        if (!storedOptions) {
          claim = await claimRequestId(env.ARCHIVE_BUCKET, optionsR2Key, callerKind);
          if (!claim.ok) {
            return refuseRequestId(claim.storedOwner);
          }
          storedOptions = await storeOptions(env.ARCHIVE_BUCKET, optionsR2Key, optionsBody, claim);
          if (!storedOptions) {
            return refuseRequestId('a concurrent caller');
          }
        }

        // Initialize request in logger
        await initLoggerRequest(env, {
          requestId,
          url,
          optionsR2Key
        });

        // Append request.created event
        await appendLogEvent(
          env,
          requestId,
          createEvent('gateway', 'request.created', 'info', 'Archive request created', {
            url,
            optionsR2Key
          })
        );

        // Trigger workflow
        const workflowResponse = await env.WORKFLOW.fetch('https://workflow/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            request_id: requestId,
            url,
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
          // The workflow worker's reply can carry raw exception text: only the internal key sees it.
          return errorResponse(
            502,
            GATEWAY_ERROR_CODES.WORKFLOW_TRIGGER_FAILED,
            'Workflow trigger failed',
            requestId,
            {
              requestId,
              errorCode: 'WORKFLOW_TRIGGER_FAILED',
              workflowStatus,
              ...(callerKind === 'internal' ? { workflowError: workflowErrorBody } : {})
            }
          );
        }

        return withRequestId(Response.json({ requestId }, { status: 201 }), requestId);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error('[gateway] Error in /begin', { id: errorId, message: errMsg }, err);
        return errorResponse(500, GATEWAY_ERROR_CODES.INTERNAL_ERROR, INTERNAL_ERROR_MESSAGE, errorId);
      }
    }

    // GET /status/:id/stream - Follow the request's events, held open at most PUBLIC_STATUS_STREAM_MAX_MS
    const streamMatch = method === 'GET' ? path.match(/^\/status\/([^/]+)\/stream$/) : null;
    if (streamMatch) {
      const requestId = streamMatch[1]!;
      if (!isValidRequestId(requestId)) {
        return errorResponse(400, GATEWAY_ERROR_CODES.INVALID_REQUEST_ID, 'Invalid request id', errorIdFor(undefined));
      }

      const headers: Record<string, string> = { 'X-Internal-API-Key': env.INTERNAL_API_KEY };
      const lastEventId = request.headers.get('Last-Event-ID');
      if (lastEventId) {
        headers['Last-Event-ID'] = lastEventId;
      }
      let response: Response;
      try {
        response = await env.LOGGER.fetch(`https://logger/request/${requestId}/stream`, { method: 'GET', headers });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error('[gateway] Error in /status stream', { id: requestId, message: errMsg }, err);
        return errorResponse(500, GATEWAY_ERROR_CODES.INTERNAL_ERROR, INTERNAL_ERROR_MESSAGE, requestId);
      }

      if (response.status === 404) {
        return errorResponse(404, GATEWAY_ERROR_CODES.REQUEST_NOT_FOUND, 'Request not found', requestId);
      }
      if (!response.ok || !response.body) {
        // The logger's error body can carry raw exception text: keep it in the server log only.
        const loggerBody = (await response.text()).slice(0, 600);
        console.error('[gateway] Status stream failed', { id: requestId, status: response.status, body: loggerBody });
        const status = response.ok ? 502 : response.status;
        return errorResponse(status, GATEWAY_ERROR_CODES.STATUS_LOOKUP_FAILED, 'Status lookup failed', requestId);
      }

      return withRequestId(
        new Response(capEventStream(response.body, PUBLIC_STATUS_STREAM_MAX_MS), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
        }),
        requestId
      );
    }

    // GET /status/:id - Get request status
    if (method === 'GET' && path.startsWith('/status/')) {
      const requestId = path.slice('/status/'.length);
      if (!requestId) {
        return errorResponse(400, GATEWAY_ERROR_CODES.REQUEST_ID_REQUIRED, 'requestId is required', errorIdFor(undefined));
      }
      // Only a request id: no other path under /status/ reaches a logger route
      if (!isValidRequestId(requestId)) {
        return errorResponse(400, GATEWAY_ERROR_CODES.INVALID_REQUEST_ID, 'Invalid request id', errorIdFor(undefined));
      }

      const errorId = errorIdFor(requestId);
      let response: Response;
      try {
        response = await loggerRequest(env, `/request/${requestId}`, 'GET');
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error('[gateway] Error in /status', { id: errorId, message: errMsg }, err);
        return errorResponse(500, GATEWAY_ERROR_CODES.INTERNAL_ERROR, INTERNAL_ERROR_MESSAGE, errorId);
      }

      if (response.status === 404) {
        return errorResponse(404, GATEWAY_ERROR_CODES.REQUEST_NOT_FOUND, 'Request not found', errorId);
      }
      if (!response.ok) {
        // The logger's error body can carry raw exception text: keep it in the server log only.
        const loggerBody = (await response.text()).slice(0, 600);
        console.error('[gateway] Status lookup failed', { id: errorId, status: response.status, body: loggerBody });
        return errorResponse(response.status, GATEWAY_ERROR_CODES.STATUS_LOOKUP_FAILED, 'Status lookup failed', errorId);
      }

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
        return errorResponse(401, GATEWAY_ERROR_CODES.UNAUTHORIZED, 'Unauthorized', errorIdFor(undefined));
      }

      let body: { requestId?: string; event?: LogEvent } | undefined;
      try {
        const parsed = (await request.json()) as { requestId: string; event: LogEvent };
        body = parsed;
        const response = await loggerRequest(env, '/event', 'POST', parsed);
        return withRequestId(
          new Response(response.body, {
            status: response.status,
            headers: { 'Content-Type': 'application/json' }
          }),
          parsed.requestId
        );
      } catch (err) {
        const errorId = errorIdFor(typeof body?.requestId === 'string' ? body.requestId : undefined);
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error('[gateway] Error in /internal/log', { id: errorId, message: errMsg }, err);
        return errorResponse(500, GATEWAY_ERROR_CODES.INTERNAL_ERROR, INTERNAL_ERROR_MESSAGE, errorId);
      }
    }

    // POST /internal/sweep-orphan-queued - retrigger queued requests that never emitted workflow events
    if (method === 'POST' && path === '/internal/sweep-orphan-queued') {
      if (!verifyInternalApiKey(request, env)) {
        return errorResponse(401, GATEWAY_ERROR_CODES.UNAUTHORIZED, 'Unauthorized', errorIdFor(undefined));
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
        const errorId = errorIdFor(undefined);
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error('[gateway] Error in /internal/sweep-orphan-queued', { id: errorId, message: errMsg }, err);
        return errorResponse(500, GATEWAY_ERROR_CODES.INTERNAL_ERROR, INTERNAL_ERROR_MESSAGE, errorId);
      }
    }

    return errorResponse(404, GATEWAY_ERROR_CODES.NOT_FOUND, 'Not found', errorIdFor(undefined));
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
  }
};
