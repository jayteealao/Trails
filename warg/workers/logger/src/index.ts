import type {
  CanonicalRequestView,
  DerivedSummary,
  InitRequestPayload,
  LogEvent,
  ArtifactRecord,
  RequestFieldsPatch,
  RequestDiagnostics,
  RequestErrorCode
} from '@warg/shared';
import { timingSafeEqual } from '@warg/shared';
import { bucketKeyForTs } from './bucket-key.js';
import { LoggerDO } from './LoggerDO.js';
import { asString, asNumber, asBoolean, asRecord } from './value-helpers.js';

export { LoggerDO };

// Cap for POST /events/batch. Producers flush per workflow step (~10–15
// events max), so this is a guardrail, not an operational limit.
const MAX_BATCH_EVENTS = 100;

interface RequestsIndexRow {
  request_id: string;
  url: string;
  domain: string;
  created_at: string;
  updated_at: string;
  last_event_ts: string | null;
  terminal_state: number;
  error_count: number;
  stage: string | null;
  manifest_r2_key: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  last_error_source: string | null;
  retry_count: number | null;
  render_ms: number | null;
  derive_ms: number | null;
  persist_ms: number | null;
  last_trace_id: string | null;
  render_provider: string | null;
  render_fallback_used: number | null;
  render_fallback_reason: string | null;
  degraded: number | null;
  degraded_steps: string | null;
}

interface LoggerServiceEnv {
  INTERNAL_API_KEY: string;
  LOGGER_DO: DurableObjectNamespace<LoggerDO>;
  INDEX_DB: D1Database;
}

interface LoggerEventWithId {
  id: number;
  ts: string;
  source: string;
  type: string;
  level: string;
  message: string;
  attempt?: number;
  data?: Record<string, unknown>;
}

interface LoggerStub {
  initRequest(payload: InitRequestPayload, createdAt: string): Promise<{ created: boolean }>;
  appendEvent(requestId: string, event: LogEvent): Promise<{ eventId: number }>;
  appendEvents(requestId: string, events: LogEvent[]): Promise<{ eventIds: number[]; derivedUpdated: boolean }>;
  upsertArtifact(requestId: string, artifact: ArtifactRecord): Promise<void> | void;
  updateRequestFields(requestId: string, patch: RequestFieldsPatch): Promise<{ updated: boolean }>;
  getRequestView(
    requestId: string,
    cursor?: number,
    limit?: number
  ): Promise<CanonicalRequestView | null> | CanonicalRequestView | null;
  getEventsForStream(
    requestId: string,
    cursor?: number,
    limit?: number
  ): Promise<{ events: LoggerEventWithId[]; derived: DerivedSummary; artifacts: ArtifactRecord[] } | null> | { events: LoggerEventWithId[]; derived: DerivedSummary; artifacts: ArtifactRecord[] } | null;
  getEvents(
    requestId: string,
    cursor?: number,
    limit?: number
  ): Promise<{ events: LogEvent[]; nextCursor?: number } | null> | { events: LogEvent[]; nextCursor?: number } | null;
}

const VALID_ERROR_CODES = new Set<RequestErrorCode>([
  'INVALID_INPUT_URL',
  'WORKFLOW_TRIGGER_FAILED',
  'NO_OUTPUTS_PRODUCED',
  'RENDER_TIMEOUT',
  'RENDER_SERVICE_ERROR',
  'RENDER_NETWORK_CLOSED',
  'RENDER_CONTEXT_DESTROYED',
  'RENDER_PREREQ_MISSING',
  'SINGLEFILE_TIMEOUT',
  'SINGLEFILE_SERVICE_ERROR',
  'SINGLEFILE_EDGE_CASE',
  'READABILITY_TIMEOUT',
  'READABILITY_SERVICE_ERROR',
  'MONOLITH_TIMEOUT',
  'MONOLITH_SERVICE_ERROR',
  'MONOLITH_SANDBOX_500',
  'MONOLITH_RPC_32MIB_LIMIT',
  'MONOLITH_INPUT_TOO_LARGE',
  'PERSIST_SERVICE_ERROR',
  'ACCESS_BLOCKED',
  'UNKNOWN_ERROR',
]);

function toRequestErrorCode(value: string | null): RequestErrorCode | undefined {
  if (!value) return undefined;
  return VALID_ERROR_CODES.has(value as RequestErrorCode)
    ? (value as RequestErrorCode)
    : undefined;
}

function toRenderProvider(
  value: string | null
): RequestDiagnostics['renderProvider'] | undefined {
  if (!value) return undefined;
  if (value === 'browser-rendering' || value === 'hyperbrowser' || value === 'unknown') {
    return value;
  }
  return 'unknown';
}

function parseStringArray(value: string | null): string[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    const strings = parsed.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
    return strings.length > 0 ? strings : undefined;
  } catch {
    return undefined;
  }
}

function toDiagnostics(row: RequestsIndexRow): RequestDiagnostics {
  return {
    errorCode: toRequestErrorCode(row.last_error_code),
    errorMessage: row.last_error_message ?? undefined,
    errorSource: row.last_error_source ?? undefined,
    retryCount: row.retry_count ?? 0,
    renderMs: row.render_ms ?? undefined,
    deriveMs: row.derive_ms ?? undefined,
    persistMs: row.persist_ms ?? undefined,
    lastTraceId: row.last_trace_id ?? undefined,
    renderProvider: toRenderProvider(row.render_provider),
    renderFallbackUsed: row.render_fallback_used === null ? undefined : row.render_fallback_used === 1,
    renderFallbackReason: row.render_fallback_reason ?? undefined,
    degraded: row.degraded === null ? undefined : row.degraded === 1,
    degradedSteps: parseStringArray(row.degraded_steps),
  };
}

function defaultRetryableForCode(code: RequestErrorCode): boolean {
  return (
    code !== 'ACCESS_BLOCKED' &&
    code !== 'INVALID_INPUT_URL' &&
    code !== 'MONOLITH_RPC_32MIB_LIMIT' &&
    code !== 'MONOLITH_INPUT_TOO_LARGE'
  );
}

function defaultActionForCode(code: RequestErrorCode): RequestDiagnostics['recommendedAction'] {
  if (code === 'ACCESS_BLOCKED') return 'check_access';
  if (code === 'INVALID_INPUT_URL') return 'inspect_url';
  if (code === 'WORKFLOW_TRIGGER_FAILED') return 'retry_full';
  if (
    code === 'RENDER_NETWORK_CLOSED' ||
    code === 'RENDER_CONTEXT_DESTROYED' ||
    code === 'RENDER_PREREQ_MISSING' ||
    code === 'NO_OUTPUTS_PRODUCED'
  ) {
    return 'retry_full';
  }
  if (code === 'SINGLEFILE_EDGE_CASE') return 'retry_step';
  if (code === 'MONOLITH_RPC_32MIB_LIMIT' || code === 'MONOLITH_INPUT_TOO_LARGE') {
    return 'investigate_service';
  }
  if (code === 'PERSIST_SERVICE_ERROR' || code === 'UNKNOWN_ERROR') return 'investigate_service';
  return 'retry_step';
}

function inferLegacyErrorCode(message: string, source?: string): RequestErrorCode {
  const lower = message.toLowerCase();
  const sourceLower = (source ?? '').toLowerCase();

  if (
    lower.includes('invalid url') ||
    lower.includes('url is required') ||
    lower.includes('base_url contains invalid characters')
  ) {
    return 'INVALID_INPUT_URL';
  }

  if (
    lower.includes('workflow trigger failed') ||
    lower.includes('error starting workflow') ||
    lower.includes('instance.already_exists')
  ) {
    return 'WORKFLOW_TRIGGER_FAILED';
  }

  if (lower.includes('no requested outputs were produced')) {
    return 'NO_OUTPUTS_PRODUCED';
  }

  if (lower.includes('unauthorized') || lower.includes('forbidden') || lower.includes('access')) {
    return 'ACCESS_BLOCKED';
  }

  if (lower.includes('missing rendered.html prerequisite')) {
    return 'RENDER_PREREQ_MISSING';
  }

  if (
    lower.includes('5006') ||
    lower.includes('network closed') ||
    lower.includes('connection closed') ||
    lower.includes('browser has disconnected')
  ) {
    return 'RENDER_NETWORK_CLOSED';
  }

  if (
    lower.includes('execution context was destroyed') ||
    lower.includes('code":6000') ||
    lower.includes('context destroyed')
  ) {
    return 'RENDER_CONTEXT_DESTROYED';
  }

  const isTimeout =
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('deadline exceeded') ||
    lower.includes('abort');

  const mentionsRender = lower.includes('/render') || lower.includes('render');
  const mentionsSinglefile = lower.includes('/singlefile') || lower.includes('singlefile');
  const mentionsReadability = lower.includes('/readability') || lower.includes('readability');
  const mentionsMonolith =
    lower.includes('/monolith') ||
    lower.includes('monolith') ||
    lower.includes('sandboxerror');
  const mentionsPersist = lower.includes('/persist') || lower.includes('persist') || sourceLower === 'gcs';

  if (isTimeout) {
    if (mentionsMonolith) return 'MONOLITH_TIMEOUT';
    if (mentionsSinglefile) return 'SINGLEFILE_TIMEOUT';
    if (mentionsReadability) return 'READABILITY_TIMEOUT';
    if (mentionsRender) return 'RENDER_TIMEOUT';
  }

  if (
    lower.includes('service error') ||
    lower.includes('http error') ||
    lower.includes('internal error') ||
    lower.includes('sandboxerror')
  ) {
    if (
      lower.includes('message length too big') ||
      lower.includes('max allowed message length') ||
      lower.includes('33554432') ||
      lower.includes('32mib')
    ) {
      return 'MONOLITH_RPC_32MIB_LIMIT';
    }
    if (lower.includes('monolith input too large')) {
      return 'MONOLITH_INPUT_TOO_LARGE';
    }
    if (
      mentionsMonolith &&
      (lower.includes('sandboxerror') || lower.includes('http error! status: 500'))
    ) {
      return 'MONOLITH_SANDBOX_500';
    }
    if (mentionsMonolith) return 'MONOLITH_SERVICE_ERROR';
    if (mentionsSinglefile) return 'SINGLEFILE_SERVICE_ERROR';
    if (mentionsReadability) return 'READABILITY_SERVICE_ERROR';
    if (mentionsPersist) return 'PERSIST_SERVICE_ERROR';
    if (mentionsRender) return 'RENDER_SERVICE_ERROR';
  }

  if (
    mentionsSinglefile &&
    (lower.includes('trustedtypes') ||
      lower.includes('trustedhtml') ||
      lower.includes('not a valid selector') ||
      lower.includes('singlefile edge-case failure'))
  ) {
    return 'SINGLEFILE_EDGE_CASE';
  }

  return 'UNKNOWN_ERROR';
}

function recomputeDiagnosticsFromEvents(events: LogEvent[]): RequestDiagnostics {
  const diagnostics: RequestDiagnostics = { retryCount: 0 };

  for (const event of events) {
    if (typeof event.attempt === 'number') {
      diagnostics.retryCount = Math.max(diagnostics.retryCount, event.attempt);
    }

    const data = event.data;
    const traceId = asString(data?.['traceId']) ?? asString(data?.['request_trace_id']);
    if (traceId) diagnostics.lastTraceId = traceId;

    if (event.type === 'step.completed') {
      const durationMs = asNumber(data?.['duration_ms']);
      const step = asString(data?.['step']);
      if (durationMs !== undefined) {
        if (step === 'render' || step === 'singlefile') diagnostics.renderMs = durationMs;
        else if (step === 'derivatives' || step === 'readability' || step === 'monolith') diagnostics.deriveMs = durationMs;
      }

      if (step === 'render') {
        const fallbackUsed = asBoolean(data?.['fallbackUsed']);
        if (fallbackUsed !== undefined) diagnostics.renderFallbackUsed = fallbackUsed;
        const fallbackReason = asString(data?.['fallbackReason']);
        if (fallbackReason) diagnostics.renderFallbackReason = fallbackReason;

        const meta = asRecord(data?.['meta']);
        const provider = asString(data?.['fallbackProvider']) ?? asString(meta?.['provider']);
        if (provider === 'hyperbrowser') {
          diagnostics.renderProvider = 'hyperbrowser';
        } else if (provider === 'browser-rendering' || provider === 'browser_rendering') {
          diagnostics.renderProvider = 'browser-rendering';
        } else if (provider) {
          diagnostics.renderProvider = 'unknown';
        } else if (fallbackUsed === false) {
          diagnostics.renderProvider = 'browser-rendering';
        } else if (fallbackUsed === true) {
          diagnostics.renderProvider = 'hyperbrowser';
        }
      }
    }

    if (event.type === 'persist.completed') {
      const durationMs = asNumber(data?.['duration_ms']);
      if (durationMs !== undefined) diagnostics.persistMs = durationMs;
    }

    if (event.type === 'workflow.completed' || event.type === 'request.done') {
      const degraded = asBoolean(data?.['degraded']);
      diagnostics.degraded = degraded ?? diagnostics.degraded ?? false;

      const degradedStepsFromList = Array.isArray(data?.['degradedSteps'])
        ? (data?.['degradedSteps'] as unknown[]).filter((entry): entry is string => typeof entry === 'string')
        : [];

      if (degradedStepsFromList.length > 0) {
        diagnostics.degradedSteps = Array.from(new Set(degradedStepsFromList));
        diagnostics.degraded = true;
      }
    }

    if (event.level === 'error') {
      const errorCode = toRequestErrorCode(asString(data?.['errorCode']) ?? null)
        ?? inferLegacyErrorCode(
          asString(data?.['error']) ?? event.message,
          event.source
        );
      diagnostics.errorCode = errorCode;
      diagnostics.errorMessage = asString(data?.['error']) ?? event.message;
      diagnostics.errorSource = event.source;
      diagnostics.retryable = asBoolean(data?.['retryable']) ?? defaultRetryableForCode(errorCode);
      diagnostics.recommendedAction =
        (asString(data?.['recommendedAction']) as RequestDiagnostics['recommendedAction'] | undefined)
        ?? defaultActionForCode(errorCode);
    }
  }

  return diagnostics;
}

/**
 * Verify internal API key.
 */
function verifyApiKey(request: Request, env: LoggerServiceEnv): boolean {
  const apiKey = request.headers.get('X-Internal-API-Key');
  if (!apiKey) return false;
  return timingSafeEqual(apiKey, env.INTERNAL_API_KEY);
}

function getStubForKey(env: LoggerServiceEnv, key: string): LoggerStub {
  const id = env.LOGGER_DO.idFromName(key);
  return env.LOGGER_DO.get(id) as unknown as LoggerStub;
}

/**
 * Legacy per-request DO stub (pre-bucket keying scheme).
 * Read/patch fallback only — new writes never target these instances.
 */
function getLegacyStub(env: LoggerServiceEnv, requestId: string): LoggerStub {
  return getStubForKey(env, requestId);
}

/**
 * Derive the bucket key a request was initialized under, via the D1 index
 * (`requests_index.created_at`). Returns null when D1 has no row (the
 * best-effort index insert failed or has not landed yet). Note pre-bucket
 * requests ARE indexed, so this returns a key for them too — their bucket DO
 * just holds no data, which is why readers fall back on a null view.
 */
async function getBucketKeyFromD1(
  env: LoggerServiceEnv,
  requestId: string
): Promise<string | null> {
  const row = await env.INDEX_DB.prepare(
    'SELECT created_at FROM requests_index WHERE request_id = ?'
  )
    .bind(requestId)
    .first<{ created_at: string }>();
  return row?.created_at ? bucketKeyForTs(row.created_at) : null;
}

/**
 * Stub for post-init writes (events, artifacts). Routes to the bucket of the
 * request's creation hour so a request's rows never straddle two buckets.
 * If D1 has no row (best-effort insert failed or raced), fall back to the
 * current-hour bucket so the write is not lost — never to a legacy DO.
 */
async function getBucketStubForWrite(
  env: LoggerServiceEnv,
  requestId: string
): Promise<LoggerStub> {
  const key = await getBucketKeyFromD1(env, requestId);
  if (key === null) {
    // H8a: D1 miss — falling back to current-hour bucket; events may be
    // unresolvable on read if the request was created in a different hour.
    console.warn(`[logger] getBucketStubForWrite: D1 miss for ${requestId} — using current-hour bucket`);

    // M24: best-effort self-heal — insert a D1 row anchored to now so all
    // future writes and reads converge on the current-hour bucket.
    // url/domain are NOT NULL; we use placeholder values since we don't have
    // the originals here (the canonical values were written by initRequest and
    // must not be overwritten — INSERT OR IGNORE preserves the original row).
    const nowIso = new Date().toISOString();
    try {
      await env.INDEX_DB.prepare(
        `INSERT OR IGNORE INTO requests_index
         (request_id, url, domain, created_at, updated_at, stage)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(requestId, '', 'unknown', nowIso, nowIso, 'queued')
        .run();
    } catch (err) {
      // Best-effort: never block the write path
      console.warn(
        `[logger] getBucketStubForWrite: self-heal D1 insert failed for ${requestId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  return getStubForKey(env, key ?? bucketKeyForTs(new Date().toISOString()));
}

/**
 * Dual-read: fetch the canonical view from the creation-hour bucket, falling
 * back to the legacy per-request DO for pre-bucket requests (their D1-derived
 * bucket DO holds no row for them, so the bucket read returns null).
 */
async function readRequestView(
  env: LoggerServiceEnv,
  requestId: string,
  cursor?: number,
  limit?: number
): Promise<CanonicalRequestView | null> {
  const key = await getBucketKeyFromD1(env, requestId);
  if (key) {
    const view = await getStubForKey(env, key).getRequestView(requestId, cursor, limit);
    if (view) return view;
    // H8b: D1 had a key but the bucket returned null — bucket miss with a
    // valid key; falling back to legacy per-request DO.
    console.warn(`[logger] readRequestView: bucket miss for ${requestId} (key=${key}) — falling back to legacy DO`);
  }
  return getLegacyStub(env, requestId).getRequestView(requestId, cursor, limit);
}

/**
 * H7: Combined resolver for the SSE stream handshake.
 * Single D1 lookup → bucket getRequestView → (on null) legacy getRequestView.
 * Returns both the stub and the already-fetched view so the SSE `init` event
 * can be sent without a second round-trip.  Returns null when neither DO knows
 * the request.
 *
 * H8b: warns when D1 had a key but the bucket returned null.
 */
async function resolveReadStubWithView(
  env: LoggerServiceEnv,
  requestId: string
): Promise<{ stub: LoggerStub; view: CanonicalRequestView } | null> {
  const key = await getBucketKeyFromD1(env, requestId);
  if (key) {
    const stub = getStubForKey(env, key);
    const view = await stub.getRequestView(requestId);
    if (view) return { stub, view };
    // H8b: bucket miss with valid key
    console.warn(`[logger] resolveReadStubWithView: bucket miss for ${requestId} (key=${key}) — falling back to legacy DO`);
  }
  const legacy = getLegacyStub(env, requestId);
  const view = await legacy.getRequestView(requestId);
  if (view) return { stub: legacy, view };
  return null;
}

/**
 * SSE stream handler for GET /request/:id/stream.
 * H7: combined resolver — one D1 lookup + one getRequestView; the
 * returned view is used directly for the `init` event below.
 * M2a: bound the resolver so a slow DO wake never hangs the handshake.
 */
async function handleSseStream(
  env: LoggerServiceEnv,
  requestId: string,
  reconnectCursor: number | undefined,
  resolveResult: { stub: LoggerStub; view: CanonicalRequestView }
): Promise<Response> {
  const { stub, view: initView } = resolveResult;

  const MAX_STREAM_MS = 2 * 60 * 1000; // 2 minutes
  const requestIdCapture = requestId;
  const abortFlag = { stopped: false };
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const streamStart = Date.now();
      let lastCursor = reconnectCursor;

      const send = (event: string, data: unknown, id?: number) => {
        let msg = `event: ${event}\n`;
        if (id !== undefined) msg += `id: ${id}\n`;
        msg += `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(msg));
      };

      try {
        // H7: use the view already fetched by resolveReadStubWithView —
        // no second round-trip needed.
        const view = initView;

        // Send init event with request metadata (always includes artifacts)
        send('init', {
          requestId: view.requestId,
          url: view.url,
          createdAt: view.createdAt,
          derived: view.derived,
          artifacts: view.artifacts,
        });

        // M15: track last-sent artifacts so state events only include
        // artifacts when they have changed (cheap JSON.stringify comparison).
        let lastArtifactsJson = JSON.stringify(view.artifacts);

        // Fetch events from cursor (or all events)
        const data = await stub.getEventsForStream(requestIdCapture, lastCursor, 500);
        if (data) {
          for (const event of data.events) {
            send('log', {
              ts: event.ts,
              source: event.source,
              type: event.type,
              level: event.level,
              message: event.message,
              attempt: event.attempt,
              data: event.data,
            }, event.id);
            lastCursor = event.id;
          }
        }

        // If already terminal, close immediately
        if (view.derived.terminal) {
          send('done', {});
          controller.close();
          return;
        }

        // Poll loop: check for new events every 3 seconds
        while (!abortFlag.stopped) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          if (abortFlag.stopped) break;

          // Enforce max stream duration
          if (Date.now() - streamStart > MAX_STREAM_MS) {
            send('timeout', {});
            controller.close();
            return;
          }

          const update = await stub.getEventsForStream(requestIdCapture, lastCursor, 100);
          if (!update) break;

          // Send new events
          for (const event of update.events) {
            send('log', {
              ts: event.ts,
              source: event.source,
              type: event.type,
              level: event.level,
              message: event.message,
              attempt: event.attempt,
              data: event.data,
            }, event.id);
            lastCursor = event.id;
          }

          // Send state update if there were new events.
          // M15: only include artifacts when they changed.
          if (update.events.length > 0) {
            const newArtifactsJson = JSON.stringify(update.artifacts);
            const artifactsChanged = newArtifactsJson !== lastArtifactsJson;
            if (artifactsChanged) {
              lastArtifactsJson = newArtifactsJson;
            }
            send('state', {
              derived: update.derived,
              ...(artifactsChanged ? { artifacts: update.artifacts } : {}),
            });
          }

          // Close on terminal
          if (update.derived.terminal) {
            send('done', {});
            controller.close();
            return;
          }
        }
      } catch (err) {
        console.error(`[logger] SSE stream error for ${requestIdCapture}:`, err);
      }

      try { controller.close(); } catch { /* already closed */ }
    },
    cancel() {
      abortFlag.stopped = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

/**
 * GET /stats handler — aggregate metrics from D1 index.
 */
async function handleGetStats(env: LoggerServiceEnv): Promise<Response> {
  const [
    stageResult,
    totalResult,
    recentResult,
    domainsResult,
    failuresResult,
    stuckResult,
    orphanQueuedResult,
    orphanQueuedOlder10mResult,
    orphanQueuedOlder60mResult
  ] = await Promise.all([
    env.INDEX_DB.prepare(
      'SELECT stage, COUNT(*) as count FROM requests_index GROUP BY stage'
    ).all<{ stage: string | null; count: number }>(),
    env.INDEX_DB.prepare(
      'SELECT COUNT(*) as total FROM requests_index'
    ).first<{ total: number }>(),
    env.INDEX_DB.prepare(
      `SELECT
        SUM(CASE WHEN created_at > datetime('now', '-1 hour') THEN 1 ELSE 0 END) as last1h,
        SUM(CASE WHEN created_at > datetime('now', '-24 hours') THEN 1 ELSE 0 END) as last24h
      FROM requests_index`
    ).first<{ last1h: number; last24h: number }>(),
    env.INDEX_DB.prepare(
      'SELECT domain, COUNT(*) as count FROM requests_index GROUP BY domain ORDER BY count DESC LIMIT 10'
    ).all<{ domain: string; count: number }>(),
    env.INDEX_DB.prepare(
      `SELECT request_id, url, created_at FROM requests_index
       WHERE stage = 'failed' ORDER BY created_at DESC LIMIT 5`
    ).all<{ request_id: string; url: string; created_at: string }>(),
    env.INDEX_DB.prepare(
      `SELECT COUNT(*) as count FROM requests_index
       WHERE terminal_state = 0 AND created_at < datetime('now', '-1 hour')`
    ).first<{ count: number }>(),
    env.INDEX_DB.prepare(
      `SELECT COUNT(*) as count FROM requests_index
       WHERE stage = 'queued'
         AND (last_event_ts IS NULL OR trim(last_event_ts) = '')`
    ).first<{ count: number }>(),
    env.INDEX_DB.prepare(
      `SELECT COUNT(*) as count FROM requests_index
       WHERE stage = 'queued'
         AND (last_event_ts IS NULL OR trim(last_event_ts) = '')
         AND created_at < datetime('now', '-10 minutes')`
    ).first<{ count: number }>(),
    env.INDEX_DB.prepare(
      `SELECT COUNT(*) as count FROM requests_index
       WHERE stage = 'queued'
         AND (last_event_ts IS NULL OR trim(last_event_ts) = '')
         AND created_at < datetime('now', '-1 hour')`
    ).first<{ count: number }>(),
  ]);

  const total = totalResult?.total ?? 0;
  const byStage: Record<string, number> = {};
  let doneCount = 0;
  let failedCount = 0;
  let activeCount = 0;

  for (const row of stageResult.results) {
    const stage = row.stage ?? 'unknown';
    byStage[stage] = row.count;
    if (stage === 'done') doneCount = row.count;
    else if (stage === 'failed') failedCount = row.count;
    else activeCount += row.count;
  }

  const terminal = doneCount + failedCount;
  const successRate = terminal > 0 ? doneCount / terminal : 0;
  const failureRate = terminal > 0 ? failedCount / terminal : 0;

  return Response.json({
    total,
    byStage,
    successRate: Math.round(successRate * 1000) / 1000,
    failureRate: Math.round(failureRate * 1000) / 1000,
    activeCount,
    stuckCount: stuckResult?.count ?? 0,
    orphanQueue: {
      total: orphanQueuedResult?.count ?? 0,
      olderThan10m: orphanQueuedOlder10mResult?.count ?? 0,
      olderThan60m: orphanQueuedOlder60mResult?.count ?? 0,
    },
    recentActivity: {
      last1h: recentResult?.last1h ?? 0,
      last24h: recentResult?.last24h ?? 0,
    },
    topDomains: domainsResult.results.map((r: { domain: string; count: number }) => ({
      domain: r.domain,
      count: r.count,
    })),
    recentFailures: failuresResult.results.map((r: { request_id: string; url: string; created_at: string }) => ({
      requestId: r.request_id,
      url: r.url,
      createdAt: r.created_at,
    })),
  });
}

/**
 * POST /maintenance/backfill-diagnostics handler — recompute missing
 * diagnostics for legacy rows.
 */
async function handleBackfillDiagnostics(
  env: LoggerServiceEnv,
  body: { limit?: number; dryRun?: boolean }
): Promise<Response> {
  const limit = Math.min(Math.max(body.limit ?? 200, 1), 1000);
  const dryRun = body.dryRun === true;

  const candidates = await env.INDEX_DB.prepare(
    `SELECT * FROM requests_index
     WHERE error_count > 0
       AND (last_error_code IS NULL OR last_error_message IS NULL OR last_error_source IS NULL)
     ORDER BY created_at DESC
     LIMIT ?`
  ).bind(limit).all<RequestsIndexRow>();

  let updated = 0;
  let derivedFromEvents = 0;
  let skipped = 0;
  const failures: Array<{ requestId: string; error: string }> = [];

  for (const row of candidates.results) {
    try {
      // Dual-read: bucket derived from the row's own created_at, then
      // the legacy per-request DO for pre-bucket rows.
      // M13: skip rows whose created_at is falsy or unparseable — fall
      // through to the legacy per-request DO below.
      let bucketKey: string | null = null;
      if (row.created_at) {
        try {
          bucketKey = bucketKeyForTs(row.created_at);
        } catch {
          // invalid timestamp; legacy fallback below
        }
      }
      let view = bucketKey
        ? await getStubForKey(env, bucketKey).getRequestView(row.request_id, undefined, 1000)
        : null;
      if (!view) {
        view = await getLegacyStub(env, row.request_id).getRequestView(
          row.request_id,
          undefined,
          1000
        );
      }
      if (!view) {
        skipped++;
        continue;
      }

      const existing = view.derived?.diagnostics;
      const diagnostics =
        existing?.errorCode && existing?.errorMessage && existing?.errorSource
          ? existing
          : recomputeDiagnosticsFromEvents(view.events);

      if (!diagnostics.errorCode && !diagnostics.errorMessage && !diagnostics.errorSource) {
        skipped++;
        continue;
      }

      if (!(existing?.errorCode && existing?.errorMessage && existing?.errorSource)) {
        derivedFromEvents++;
      }

      if (!dryRun) {
        await env.INDEX_DB.prepare(
          `UPDATE requests_index
           SET last_error_code = ?,
               last_error_message = ?,
               last_error_source = ?,
               retry_count = ?,
               render_ms = ?,
               derive_ms = ?,
               persist_ms = ?,
               last_trace_id = ?,
               render_provider = ?,
               render_fallback_used = ?,
               render_fallback_reason = ?,
               degraded = ?,
               degraded_steps = ?,
               updated_at = ?
           WHERE request_id = ?`
        )
          .bind(
            diagnostics.errorCode ?? null,
            diagnostics.errorMessage ?? null,
            diagnostics.errorSource ?? null,
            diagnostics.retryCount ?? 0,
            diagnostics.renderMs ?? null,
            diagnostics.deriveMs ?? null,
            diagnostics.persistMs ?? null,
            diagnostics.lastTraceId ?? null,
            diagnostics.renderProvider ?? null,
            diagnostics.renderFallbackUsed === undefined
              ? null
              : diagnostics.renderFallbackUsed ? 1 : 0,
            diagnostics.renderFallbackReason ?? null,
            diagnostics.degraded === undefined ? null : diagnostics.degraded ? 1 : 0,
            diagnostics.degradedSteps?.length
              ? JSON.stringify(diagnostics.degradedSteps)
              : null,
            new Date().toISOString(),
            row.request_id
          )
          .run();
      }

      updated++;
    } catch (err) {
      failures.push({
        requestId: row.request_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return Response.json({
    dryRun,
    scanned: candidates.results.length,
    updated,
    derivedFromEvents,
    skipped,
    failures,
  });
}

/**
 * Parse URL pathname and params.
 */
function parseRoute(
  url: URL
): { path: string; requestId?: string; params: URLSearchParams } {
  const path = url.pathname;
  const params = url.searchParams;

  // Literal routes take priority over parameterized ones
  if (path === '/request/init' || path === '/event' || path === '/events/batch' ||
      path === '/artifact' || path === '/stats' || path === '/requests' ||
      path === '/requests/batch' || path === '/maintenance/backfill-diagnostics') {
    return { path, params };
  }

  // Match /request/:id/stream pattern (before /request/:id to avoid ambiguity)
  const streamMatch = path.match(/^\/request\/([^/]+)\/stream$/);
  if (streamMatch) {
    return { path: '/request/:id/stream', requestId: streamMatch[1], params };
  }

  // Match /request/:id pattern
  const requestMatch = path.match(/^\/request\/([^/]+)$/);
  if (requestMatch) {
    return { path: '/request/:id', requestId: requestMatch[1], params };
  }

  // Match /request/:id/events pattern
  const eventsMatch = path.match(/^\/request\/([^/]+)\/events$/);
  if (eventsMatch) {
    return { path: '/request/:id/events', requestId: eventsMatch[1], params };
  }

  return { path, params };
}

export default {
  async fetch(request: Request, env: LoggerServiceEnv): Promise<Response> {
    // Verify API key for all routes
    if (!verifyApiKey(request, env)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const { path, requestId, params } = parseRoute(url);
    const method = request.method;

    try {
      // POST /request/init - Initialize a new request
      if (method === 'POST' && path === '/request/init') {
        const payload = (await request.json()) as InitRequestPayload;
        // The same timestamp picks the bucket AND becomes created_at, so
        // reads deriving the bucket from created_at can never miss it.
        const nowIso = new Date().toISOString();
        const stub = getStubForKey(env, bucketKeyForTs(nowIso));
        const result = await stub.initRequest(payload, nowIso);
        return Response.json(result, { status: result.created ? 201 : 200 });
      }

      // POST /event - Append an event (requires requestId in body)
      if (method === 'POST' && path === '/event') {
        const body = (await request.json()) as { requestId: string; event: LogEvent };
        if (typeof body.requestId !== 'string' || body.requestId.length === 0) {
          return Response.json(
            { error: 'Body must contain a non-empty string requestId' },
            { status: 400 }
          );
        }
        const stub = await getBucketStubForWrite(env, body.requestId);
        const result = await stub.appendEvent(body.requestId, body.event);
        return Response.json(result);
      }

      // POST /events/batch - Append events atomically (requires requestId in body).
      // One bucket lookup + one DO round-trip for the whole batch.
      if (method === 'POST' && path === '/events/batch') {
        const body = (await request.json()) as { requestId: string; events: LogEvent[] };
        if (typeof body.requestId !== 'string' || body.requestId.length === 0 || !Array.isArray(body.events)) {
          return Response.json(
            { error: 'Body must be { requestId: string, events: LogEvent[] }' },
            { status: 400 }
          );
        }
        // M3c: short-circuit empty batch before any DO/bucket lookup
        if (body.events.length === 0) {
          return Response.json({ eventIds: [], derivedUpdated: false });
        }
        if (body.events.length > MAX_BATCH_EVENTS) {
          return Response.json(
            { error: `Batch exceeds ${MAX_BATCH_EVENTS} events` },
            { status: 400 }
          );
        }
        const stub = await getBucketStubForWrite(env, body.requestId);
        const result = await stub.appendEvents(body.requestId, body.events);
        if (!result.derivedUpdated) {
          console.warn(`[logger] appendEvents: no request row found for ${body.requestId} — routing anomaly`);
        }
        return Response.json(result);
      }

      // POST /artifact - Upsert an artifact (requires requestId in body)
      if (method === 'POST' && path === '/artifact') {
        const body = (await request.json()) as { requestId: string; artifact: ArtifactRecord };
        if (typeof body.requestId !== 'string' || body.requestId.length === 0) {
          return Response.json(
            { error: 'Body must contain a non-empty string requestId' },
            { status: 400 }
          );
        }
        const stub = await getBucketStubForWrite(env, body.requestId);
        await stub.upsertArtifact(body.requestId, body.artifact);
        return Response.json({ ok: true });
      }

      // PATCH /request/:id - Update request fields. Targets the request's
      // creation-hour bucket; requests still living in a legacy per-request
      // DO (initialized before the bucket cutover) are patched there.
      if (method === 'PATCH' && path === '/request/:id' && requestId) {
        const patch = (await request.json()) as RequestFieldsPatch;
        const key = await getBucketKeyFromD1(env, requestId);
        let updated = false;
        if (key) {
          updated = (await getStubForKey(env, key).updateRequestFields(requestId, patch)).updated;
        }
        if (!updated) {
          updated = (await getLegacyStub(env, requestId).updateRequestFields(requestId, patch)).updated;
        }
        if (!updated) {
          return Response.json({ error: 'Request not found' }, { status: 404 });
        }
        return Response.json({ ok: true });
      }

      // GET /request/:id - Get full request view (dual-read)
      if (method === 'GET' && path === '/request/:id' && requestId) {
        const cursor = params.get('cursor');
        const limitParam = params.get('limit');
        const limitVal = Math.min(Math.max(parseInt(limitParam ?? '', 10) || 100, 1), 1000);
        const view = await readRequestView(
          env,
          requestId,
          cursor ? parseInt(cursor, 10) : undefined,
          limitVal
        );
        if (!view) {
          return Response.json({ error: 'Request not found' }, { status: 404 });
        }
        return Response.json(view);
      }

      // GET /request/:id/stream - SSE event stream (dual-read stub)
      if (method === 'GET' && path === '/request/:id/stream' && requestId) {
        // H7: combined resolver — one D1 lookup + one getRequestView; the
        // returned view is used directly for the `init` event below.
        // M2a: bound the resolver so a slow DO wake never hangs the handshake.
        const RESOLVER_TIMEOUT_MS = 10_000;
        const TIMEOUT_SENTINEL = Symbol('timeout');
        const resolveTimeout = new Promise<typeof TIMEOUT_SENTINEL>((resolve) =>
          setTimeout(() => resolve(TIMEOUT_SENTINEL), RESOLVER_TIMEOUT_MS)
        );
        const resolveResult = await Promise.race([
          resolveReadStubWithView(env, requestId),
          resolveTimeout,
        ]);
        if (resolveResult === TIMEOUT_SENTINEL) {
          return Response.json({ error: 'Resolver timeout' }, { status: 503 });
        }
        if (!resolveResult) {
          return Response.json({ error: 'Request not found' }, { status: 404 });
        }

        // Read reconnection cursor from Last-Event-ID header
        const lastEventIdHeader = request.headers.get('Last-Event-ID');
        const parsed = lastEventIdHeader ? parseInt(lastEventIdHeader, 10) : undefined;
        const reconnectCursor = parsed !== undefined && !Number.isNaN(parsed) ? parsed : undefined;

        return handleSseStream(env, requestId, reconnectCursor, resolveResult);
      }

      // GET /request/:id/events - Get paginated events (dual-read)
      if (method === 'GET' && path === '/request/:id/events' && requestId) {
        const cursor = params.get('cursor');
        const limitParam = params.get('limit');
        const limitVal = Math.min(Math.max(parseInt(limitParam ?? '', 10) || 100, 1), 1000);
        const cursorVal = cursor ? parseInt(cursor, 10) : undefined;

        const key = await getBucketKeyFromD1(env, requestId);
        let result = key
          ? await getStubForKey(env, key).getEvents(requestId, cursorVal, limitVal)
          : null;
        if (!result) {
          result = await getLegacyStub(env, requestId).getEvents(requestId, cursorVal, limitVal);
        }
        // Unknown request keeps the historical wire shape: an empty page.
        return Response.json(result ?? { events: [] });
      }

      // GET /stats - Aggregate metrics from D1 index
      if (method === 'GET' && path === '/stats') {
        return handleGetStats(env);
      }

      // POST /requests/batch - Batch fetch request summaries from D1 index
      if (method === 'POST' && path === '/requests/batch') {
        const body = (await request.json()) as { requestIds: string[] };
        const ids = body.requestIds;
        if (!Array.isArray(ids) || ids.length === 0) {
          return Response.json({ error: 'requestIds must be a non-empty array' }, { status: 400 });
        }
        const capped = ids.slice(0, 50);
        const placeholders = capped.map(() => '?').join(',');
        const result = await env.INDEX_DB.prepare(
          `SELECT * FROM requests_index WHERE request_id IN (${placeholders})`
        ).bind(...capped).all<RequestsIndexRow>();

        return Response.json({
          requests: result.results.map((row: RequestsIndexRow) => ({
            requestId: row.request_id,
            url: row.url,
            domain: row.domain,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            lastEventTs: row.last_event_ts,
            terminal: row.terminal_state === 1,
            errorCount: row.error_count,
            stage: row.stage,
            manifestR2Key: row.manifest_r2_key,
            diagnostics: toDiagnostics(row),
          })),
        });
      }

      // POST /maintenance/backfill-diagnostics - Recompute missing diagnostics for legacy rows
      if (method === 'POST' && path === '/maintenance/backfill-diagnostics') {
        const body = await request
          .json()
          .catch(() => ({})) as { limit?: number; dryRun?: boolean };
        return handleBackfillDiagnostics(env, body);
      }

      // GET /requests - List requests from D1 index
      if (method === 'GET' && path === '/requests') {
        const domain = params.get('domain');
        const status = params.get('status');
        const q = params.get('q');
        const from = params.get('from');
        const to = params.get('to');
        const limitVal = Math.min(Math.max(parseInt(params.get('limit') ?? '', 10) || 50, 1), 1000);
        const offsetVal = Math.min(Math.max(parseInt(params.get('offset') ?? '', 10) || 0, 0), 100000);

        let query = 'SELECT * FROM requests_index';
        const conditions: string[] = [];
        const bindings: (string | number)[] = [];

        if (domain) {
          conditions.push('domain = ?');
          bindings.push(domain);
        }
        if (status) {
          conditions.push('stage = ?');
          bindings.push(status);
        }
        if (q) {
          conditions.push("url LIKE '%' || ? || '%'");
          bindings.push(q);
        }
        if (from) {
          conditions.push('created_at >= ?');
          bindings.push(from);
        }
        if (to) {
          conditions.push('created_at <= ?');
          bindings.push(to);
        }
        if (conditions.length > 0) {
          query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        bindings.push(limitVal, offsetVal);

        const result = await env.INDEX_DB.prepare(query).bind(...bindings).all<RequestsIndexRow>();

        return Response.json({
          requests: result.results.map((row: RequestsIndexRow) => ({
            requestId: row.request_id,
            url: row.url,
            domain: row.domain,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            lastEventTs: row.last_event_ts,
            terminal: row.terminal_state === 1,
            errorCount: row.error_count,
            stage: row.stage,
            manifestR2Key: row.manifest_r2_key,
            diagnostics: toDiagnostics(row),
          })),
          meta: {
            count: result.results.length,
            success: result.success
          }
        });
      }

      return Response.json({ error: 'Not found' }, { status: 404 });
    } catch (err) {
      console.error('[logger] Unhandled error:', err);
      const errMsg = err instanceof Error ? err.message : String(err);
      return Response.json({ error: 'Internal error', message: errMsg }, { status: 500 });
    }
  }
};
