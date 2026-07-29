import { DurableObject } from 'cloudflare:workers';
import type {
  LogEvent,
  ArtifactRecord,
  DerivedSummary,
  RequestDiagnostics,
  CanonicalRequestView,
  InitRequestPayload,
  RequestFieldsPatch,
  RequestStage,
  TerminalState
} from '@warg/shared';
import { initSchema, migrateSchema } from './schema.js';
import { asNumber, asString, asBoolean, asRecord } from './value-helpers.js';

interface LoggerDoEnv {
  INDEX_DB: D1Database;
}

interface RequestRow extends Record<string, SqlStorageValue> {
  request_id: string;
  url: string;
  created_at: string;
  options_r2_key: string | null;
  manifest_r2_key: string | null;
  external_json: string | null;
  derived_json: string;
}

interface EventRow extends Record<string, SqlStorageValue> {
  id: number;
  request_id: string;
  ts: string;
  source: string;
  type: string;
  level: string;
  message: string;
  attempt: number | null;
  data_json: string | null;
}

interface ArtifactRow extends Record<string, SqlStorageValue> {
  request_id: string;
  kind: string;
  r2_key: string;
  content_type: string;
  bytes: number;
  sha256: string;
}

/**
 * Derive stage from event type and optional event data.
 * step.started uses data.step to distinguish rendering vs deriving.
 * step.completed/step.failed don't regress the stage.
 * workflow.completed/workflow.failed are terminal fallbacks in case
 * request.done/request.failed events are missing.
 */
function deriveStage(
  eventType: string,
  eventData?: Record<string, unknown>
): RequestStage | TerminalState | undefined {
  if (eventType === 'request.done' || eventType === 'workflow.completed') return 'done';
  if (eventType === 'request.failed' || eventType === 'workflow.failed') return 'failed';
  if (eventType.startsWith('persist.')) return 'persisting';
  if (eventType === 'step.started') {
    const step = eventData?.step as string | undefined;
    if (step === 'render' || step === 'singlefile') return 'rendering';
    if (step === 'derivatives' || step === 'readability' || step === 'monolith') return 'deriving';
    return undefined;
  }
  // step.completed / step.failed: don't change stage (keep current)
  if (eventType === 'step.completed' || eventType === 'step.failed') return undefined;
  if (eventType === 'artifact.written') return undefined;
  if (eventType === 'workflow.started') return 'queued';
  if (eventType === 'request.created') return 'queued';
  return undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  return strings.length > 0 ? strings : undefined;
}

function normalizeRenderProvider(value: string | undefined): RequestDiagnostics['renderProvider'] | undefined {
  if (!value) return undefined;
  const lower = value.toLowerCase();
  if (lower === 'hyperbrowser') return 'hyperbrowser';
  if (lower === 'browser-rendering' || lower === 'browser_rendering') return 'browser-rendering';
  return 'unknown';
}

function shouldMarkIncompleteFromDiagnostics(
  diagnostics: RequestDiagnostics | undefined
): boolean {
  if (!diagnostics?.degraded) return false;
  const degradedSteps = diagnostics.degradedSteps ?? [];
  return degradedSteps.includes('monolith');
}

function isArtifactKind(value: string): value is ArtifactRecord['kind'] {
  return (
    value === 'rendered.html' ||
    value === 'rendered.md' ||
    value === 'screenshot.png' ||
    value === 'page.pdf' ||
    value === 'singlefile.html' ||
    value === 'readability.json' ||
    value === 'readability.md' ||
    value === 'monolith.html' ||
    value === 'manifest.json'
  );
}

function artifactFromEvent(event: LogEvent): ArtifactRecord | undefined {
  if (event.type !== 'artifact.written' || !event.data) return undefined;

  const kindRaw = asString(event.data['kind']);
  const r2Key = asString(event.data['r2Key']);
  const contentType = asString(event.data['contentType']);
  const sha256 = asString(event.data['sha256']);
  const bytes = asNumber(event.data['bytes']);

  if (!kindRaw || !isArtifactKind(kindRaw)) return undefined;
  if (!r2Key || !contentType || !sha256 || bytes === undefined) return undefined;

  return {
    kind: kindRaw,
    r2Key,
    contentType,
    bytes,
    sha256,
  };
}

function updateDiagnostics(
  existing: RequestDiagnostics | undefined,
  event: LogEvent
): RequestDiagnostics {
  const diagnostics: RequestDiagnostics = existing
    ? { ...existing }
    : { retryCount: 0 };
  if (typeof diagnostics.retryCount !== 'number' || Number.isNaN(diagnostics.retryCount)) {
    diagnostics.retryCount = 0;
  }
  const data = event.data;

  if (typeof event.attempt === 'number') {
    diagnostics.retryCount = Math.max(diagnostics.retryCount, event.attempt);
  }

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
      if (fallbackUsed !== undefined) {
        diagnostics.renderFallbackUsed = fallbackUsed;
      }

      const fallbackReason = asString(data?.['fallbackReason']);
      if (fallbackReason) {
        diagnostics.renderFallbackReason = fallbackReason;
      }

      const meta = asRecord(data?.['meta']);
      const provider = normalizeRenderProvider(
        asString(data?.['fallbackProvider']) ??
          asString(meta?.['provider']) ??
          (fallbackUsed === false ? 'browser-rendering' : undefined)
      );
      if (provider) {
        diagnostics.renderProvider = provider;
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
    if (degraded !== undefined) {
      diagnostics.degraded = degraded;
    } else {
      diagnostics.degraded = false;
    }

    const degradedStepsFromEvent = asStringArray(data?.['degradedSteps']);
    if (degradedStepsFromEvent && degradedStepsFromEvent.length > 0) {
      diagnostics.degradedSteps = Array.from(new Set(degradedStepsFromEvent));
      diagnostics.degraded = true;
    } else if (Array.isArray(data?.['partialFailures'])) {
      const degradedSteps = (data?.['partialFailures'] as unknown[])
        .map((entry) => asRecord(entry)?.['step'])
        .filter((step): step is string => typeof step === 'string' && step.length > 0);
      if (degradedSteps.length > 0) {
        diagnostics.degradedSteps = Array.from(new Set(degradedSteps));
        diagnostics.degraded = true;
      } else if (diagnostics.degraded === false) {
        diagnostics.degradedSteps = undefined;
      }
    } else if (diagnostics.degraded === false) {
      diagnostics.degradedSteps = undefined;
    }
  }

  if (event.level === 'error') {
    const errorCode = asString(data?.['errorCode']) as RequestDiagnostics['errorCode'] | undefined;
    diagnostics.errorCode = errorCode ?? 'UNKNOWN_ERROR';
    diagnostics.errorMessage = asString(data?.['error']) ?? event.message;
    diagnostics.errorSource = event.source;
    diagnostics.retryable = asBoolean(data?.['retryable']) ?? diagnostics.retryable;
    const recommendedAction = asString(data?.['recommendedAction']);
    if (recommendedAction) {
      diagnostics.recommendedAction = recommendedAction as RequestDiagnostics['recommendedAction'];
    }
  }

  return diagnostics;
}

/**
 * Extract domain from URL.
 */
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

/**
 * Apply a single event to a mutable DerivedSummary in-place.
 * Encapsulates the stage machine, terminal flags, errorCount, lastEventTs,
 * diagnostics update, and the degraded-monolith incomplete override.
 * Pure with respect to storage — no SQL side-effects.
 */
function applyEventToDerived(derived: DerivedSummary, event: LogEvent): void {
  const newStage = deriveStage(event.type, event.data);
  if (newStage) {
    derived.stage = newStage;
    derived.terminal =
      newStage === 'done' ||
      newStage === 'failed' ||
      newStage === 'incomplete';
  }

  if (event.level === 'error') {
    derived.errorCount++;
  }

  derived.lastEventTs = event.ts;
  derived.diagnostics = updateDiagnostics(derived.diagnostics, event);

  if (
    (event.type === 'request.done' || event.type === 'workflow.completed') &&
    shouldMarkIncompleteFromDiagnostics(derived.diagnostics)
  ) {
    derived.stage = 'incomplete';
    derived.terminal = true;
  }
}

export class LoggerDO extends DurableObject<LoggerDoEnv> {
  private sql: SqlStorage;
  private initialized = false;

  constructor(ctx: DurableObjectState, env: LoggerDoEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
  }

  /**
   * Initialise the SQLite schema on first use.
   * Relies on the DO single-threaded execution model (one request at a time
   * per instance) — no locking is needed; a concurrent "fix" adding a mutex
   * here would be unnecessary.
   */
  private ensureSchema(): void {
    if (!this.initialized) {
      initSchema(this.sql);
      migrateSchema(this.sql);
      this.initialized = true;
    }
  }

  /**
   * Update the D1 requests_index row for a request (best-effort).
   * @param requestId   - The request to update.
   * @param lastEventTs - The ts of the event that drove the derived change.
   * @param derived     - Final derived summary to write.
   */
  private async updateD1Index(
    requestId: string,
    lastEventTs: string,
    derived: DerivedSummary
  ): Promise<void> {
    try {
      await this.env.INDEX_DB.prepare(
        `UPDATE requests_index
         SET updated_at = ?, last_event_ts = ?, stage = ?,
             terminal_state = ?, error_count = ?,
             last_error_code = ?, last_error_message = ?, last_error_source = ?,
             retry_count = ?, render_ms = ?, derive_ms = ?, persist_ms = ?,
             last_trace_id = ?, render_provider = ?, render_fallback_used = ?,
             render_fallback_reason = ?, degraded = ?, degraded_steps = ?
         WHERE request_id = ?`
      )
        .bind(
          new Date().toISOString(),
          lastEventTs,
          derived.stage,
          derived.terminal ? 1 : 0,
          derived.errorCount,
          derived.diagnostics?.errorCode ?? null,
          derived.diagnostics?.errorMessage ?? null,
          derived.diagnostics?.errorSource ?? null,
          derived.diagnostics?.retryCount ?? 0,
          derived.diagnostics?.renderMs ?? null,
          derived.diagnostics?.deriveMs ?? null,
          derived.diagnostics?.persistMs ?? null,
          derived.diagnostics?.lastTraceId ?? null,
          derived.diagnostics?.renderProvider ?? null,
          derived.diagnostics?.renderFallbackUsed === true ? 1 : 0,
          derived.diagnostics?.renderFallbackReason ?? null,
          derived.diagnostics?.degraded === true ? 1 : 0,
          derived.diagnostics?.degradedSteps?.length
            ? JSON.stringify(derived.diagnostics.degradedSteps)
            : null,
          requestId
        )
        .run();
    } catch (err) {
      console.error(`D1 index update failed for ${requestId}:`, err instanceof Error ? err.message : err);
    }
  }

  /**
   * Initialize a new request record.
   * Idempotent: if request already exists, returns existing data.
   *
   * `createdAt` is supplied by the service so it always falls inside this
   * bucket's hour — reads derive the bucket key from the D1-indexed
   * created_at, so the two must never straddle an hour boundary.
   */
  async initRequest(
    payload: InitRequestPayload,
    createdAt: string
  ): Promise<{ created: boolean }> {
    this.ensureSchema();

    const existing = this.sql
      .exec<RequestRow>('SELECT request_id FROM requests WHERE request_id = ?', payload.requestId)
      .toArray();

    if (existing.length > 0) {
      return { created: false };
    }

    const now = createdAt;
    const initialDerived: DerivedSummary = {
      stage: 'queued',
      errorCount: 0,
      lastEventTs: undefined,
      terminal: false
    };

    this.sql.exec(
      `INSERT INTO requests (request_id, url, created_at, options_r2_key, derived_json)
       VALUES (?, ?, ?, ?, ?)`,
      payload.requestId,
      payload.url,
      now,
      payload.optionsR2Key ?? null,
      JSON.stringify(initialDerived)
    );

    // Update D1 index (best-effort). Idempotent upsert: a re-driven request_id
    // re-inits under the current-hour bucket, so re-point its D1 row's
    // created_at to this hour — otherwise routing (getBucketStubForWrite reads
    // created_at) keeps sending events to the stale original bucket, whose DO
    // holds no row (D5). Preserve the canonical url/domain from the first init.
    try {
      await this.env.INDEX_DB.prepare(
        `INSERT INTO requests_index
         (request_id, url, domain, created_at, updated_at, stage)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(request_id) DO UPDATE SET
           created_at = excluded.created_at,
           updated_at = excluded.updated_at,
           stage = excluded.stage`
      )
        .bind(
          payload.requestId,
          payload.url,
          extractDomain(payload.url),
          now,
          now,
          'queued'
        )
        .run();
    } catch (err) {
      console.error(`D1 index insert failed for ${payload.requestId}:`, err instanceof Error ? err.message : err);
    }

    return { created: true };
  }

  /**
   * Append an event to the request trace.
   * Updates derived summary.
   */
  async appendEvent(requestId: string, event: LogEvent): Promise<{ eventId: number }> {
    this.ensureSchema();

    // Insert event and retrieve its auto-increment id in one statement
    const insertRow = this.sql.exec<{ id: number }>(
      `INSERT INTO events (request_id, ts, source, type, level, message, attempt, data_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      requestId,
      event.ts,
      event.source,
      event.type,
      event.level,
      event.message,
      event.attempt ?? null,
      event.data ? JSON.stringify(event.data) : null
    ).one();
    const eventId = insertRow?.id ?? 0;

    const artifact = artifactFromEvent(event);
    if (artifact) {
      this.upsertArtifact(requestId, artifact);
    }

    // Update derived summary (only request_id + derived_json needed here).
    // Tolerate zero rows: a re-driven request_id can route here before its
    // row exists in this bucket (D5). Events are still stored above; only the
    // derived update is skipped when no row is found.
    const requestRows = this.sql
      .exec<Pick<RequestRow, 'request_id' | 'derived_json'>>(
        'SELECT request_id, derived_json FROM requests WHERE request_id = ? LIMIT 1',
        requestId
      )
      .toArray();
    const requestRow = requestRows[0];
    if (requestRow) {
      const derived: DerivedSummary = JSON.parse(requestRow.derived_json);

      applyEventToDerived(derived, event);

      this.sql.exec(
        'UPDATE requests SET derived_json = ? WHERE request_id = ?',
        JSON.stringify(derived),
        requestRow.request_id
      );

      await this.updateD1Index(requestRow.request_id, event.ts, derived);
    }

    return { eventId };
  }

  /**
   * Append a batch of events to the request trace atomically.
   *
   * Replays the same per-event state machine as appendEvent in order, so the
   * final derived summary is identical to N sequential appendEvent calls.
   * All SQLite writes happen in one transaction (all-or-nothing); the D1
   * index is updated once with the final derived state instead of per event.
   *
   * ASSUMPTION: callers supply events in chronological order. The last
   * event's `ts` becomes D1's `last_event_ts`.
   *
   * @returns `eventIds` — the inserted row ids in order.
   * @returns `derivedUpdated` — true when a request row existed and
   *   derived_json was updated. False means no request row was found (routing
   *   anomaly): events are still stored but derived state is unchanged.
   */
  async appendEvents(
    requestId: string,
    events: LogEvent[]
  ): Promise<{ eventIds: number[]; derivedUpdated: boolean }> {
    this.ensureSchema();

    if (events.length === 0) {
      return { eventIds: [], derivedUpdated: false };
    }

    // These are reset at the top of the transactionSync callback so a runtime
    // retry of the callback cannot accumulate duplicates (M9a).
    let eventIds: number[] = [];
    let finalDerived: DerivedSummary | undefined;
    let derivedUpdated = false;

    try {
      this.ctx.storage.transactionSync(() => {
        // Reset closure state here so a callback retry starts clean (M9a).
        eventIds = [];
        finalDerived = undefined;
        derivedUpdated = false;

        const requestRows = this.sql
          .exec<Pick<RequestRow, 'request_id' | 'derived_json'>>(
            'SELECT request_id, derived_json FROM requests WHERE request_id = ? LIMIT 1',
            requestId
          )
          .toArray();
        const requestRow = requestRows[0];
        // Same contract as appendEvent: events are stored even when this
        // instance holds no request row; only the derived update is skipped.
        const derived: DerivedSummary | undefined = requestRow
          ? JSON.parse(requestRow.derived_json)
          : undefined;

        for (const event of events) {
          const insertRow = this.sql.exec<{ id: number }>(
            `INSERT INTO events (request_id, ts, source, type, level, message, attempt, data_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             RETURNING id`,
            requestId,
            event.ts,
            event.source,
            event.type,
            event.level,
            event.message,
            event.attempt ?? null,
            event.data ? JSON.stringify(event.data) : null
          ).one();
          eventIds.push(insertRow?.id ?? 0);

          const artifact = artifactFromEvent(event);
          if (artifact) {
            this.upsertArtifact(requestId, artifact);
          }

          if (!derived) continue;

          applyEventToDerived(derived, event);
        }

        if (requestRow && derived) {
          this.sql.exec(
            'UPDATE requests SET derived_json = ? WHERE request_id = ?',
            JSON.stringify(derived),
            requestRow.request_id
          );
          finalDerived = derived;
          derivedUpdated = true;
        }
      });
    } catch (err) {
      console.error(
        `[logger] appendEvents transaction failed for ${requestId} (${events.length} events):`,
        err instanceof Error ? err.message : err
      );
      throw err; // re-throw so the workflow step can retry
    }

    // Update D1 index once with the final state (best-effort).
    // Non-terminal batches skip the best-effort D1 update so they never
    // race/regress the subsequent terminal event's D1 write (terminals are
    // sent per-event by design via appendEvent).
    if (finalDerived?.terminal) {
      const lastEvent = events[events.length - 1]!;
      await this.updateD1Index(requestId, lastEvent.ts, finalDerived);
    }

    return { eventIds, derivedUpdated };
  }

  /**
   * Upsert an artifact record.
   * Multiple artifacts of the same kind with different r2_key are allowed.
   */
  upsertArtifact(requestId: string, artifact: ArtifactRecord): void {
    this.ensureSchema();

    this.sql.exec(
      `INSERT OR REPLACE INTO artifacts (request_id, kind, r2_key, content_type, bytes, sha256)
       VALUES (?, ?, ?, ?, ?, ?)`,
      requestId,
      artifact.kind,
      artifact.r2Key,
      artifact.contentType,
      artifact.bytes,
      artifact.sha256
    );
  }

  /**
   * Update request fields (manifest_r2_key, external_json).
   * Returns `{ updated: false }` when this instance holds no row for the
   * request, so the service can fall back to the legacy per-request DO.
   */
  async updateRequestFields(
    requestId: string,
    patch: RequestFieldsPatch
  ): Promise<{ updated: boolean }> {
    this.ensureSchema();

    const requestRows = this.sql
      .exec<RequestRow>('SELECT * FROM requests WHERE request_id = ? LIMIT 1', requestId)
      .toArray();
    const requestRow = requestRows[0];
    if (!requestRow) {
      return { updated: false };
    }

    const updates: string[] = [];
    const values: (string | null)[] = [];

    if (patch.manifestR2Key !== undefined) {
      updates.push('manifest_r2_key = ?');
      values.push(patch.manifestR2Key);
    }

    if (patch.externalJson !== undefined) {
      updates.push('external_json = ?');
      values.push(JSON.stringify(patch.externalJson));
    }

    if (updates.length > 0) {
      values.push(requestRow.request_id);
      this.sql.exec(
        `UPDATE requests SET ${updates.join(', ')} WHERE request_id = ?`,
        ...values
      );

      // Update D1 index (best-effort)
      if (patch.manifestR2Key !== undefined) {
        try {
          await this.env.INDEX_DB.prepare(
            `UPDATE requests_index SET manifest_r2_key = ?, updated_at = ? WHERE request_id = ?`
          )
            .bind(patch.manifestR2Key, new Date().toISOString(), requestRow.request_id)
            .run();
        } catch (err) {
          console.error(`D1 index manifest update failed for ${requestRow.request_id}:`, err instanceof Error ? err.message : err);
        }
      }
    }

    return { updated: true };
  }

  /**
   * Get the full canonical view of a request.
   */
  getRequestView(requestId: string, cursor?: number, limit = 100): CanonicalRequestView | null {
    this.ensureSchema();

    const requestRows = this.sql
      .exec<RequestRow>('SELECT * FROM requests WHERE request_id = ? LIMIT 1', requestId)
      .toArray();
    if (requestRows.length === 0) {
      return null;
    }
    const requestRow = requestRows[0]!;

    // Get events with pagination
    const eventQuery = cursor !== undefined
      ? 'SELECT * FROM events WHERE request_id = ? AND id > ? ORDER BY id ASC LIMIT ?'
      : 'SELECT * FROM events WHERE request_id = ? ORDER BY id ASC LIMIT ?';

    const eventArgs = cursor !== undefined ? [requestId, cursor, limit + 1] : [requestId, limit + 1];
    const eventRows = this.sql.exec<EventRow>(eventQuery, ...eventArgs).toArray();

    const hasMore = eventRows.length > limit;
    const events = eventRows.slice(0, limit);
    const nextCursor = hasMore && events.length > 0 ? events[events.length - 1]!.id : undefined;

    // Get the request's artifacts
    const artifactRows = this.sql
      .exec<ArtifactRow>('SELECT * FROM artifacts WHERE request_id = ?', requestId)
      .toArray();

    const derived: DerivedSummary = JSON.parse(requestRow.derived_json);
    const externalJson = requestRow.external_json
      ? (JSON.parse(requestRow.external_json) as Record<string, unknown>)
      : undefined;

    const view: CanonicalRequestView = {
      requestId: requestRow.request_id,
      url: requestRow.url,
      createdAt: requestRow.created_at,
      optionsR2Key: requestRow.options_r2_key ?? undefined,
      manifestR2Key: requestRow.manifest_r2_key ?? undefined,
      externalJson,
      derived,
      events: events.map((row) => ({
        ts: row.ts,
        source: row.source as LogEvent['source'],
        type: row.type as LogEvent['type'],
        level: row.level as LogEvent['level'],
        message: row.message,
        attempt: row.attempt ?? undefined,
        data: row.data_json ? (JSON.parse(row.data_json) as Record<string, unknown>) : undefined
      })),
      artifacts: artifactRows.map((row) => ({
        kind: row.kind as ArtifactRecord['kind'],
        r2Key: row.r2_key,
        contentType: row.content_type,
        bytes: row.bytes,
        sha256: row.sha256
      })),
      nextCursor
    };

    return view;
  }

  /**
   * Get events with their auto-increment IDs, plus derived state and artifacts.
   * Used by the SSE stream handler — IDs become SSE `id:` fields for reconnection.
   */
  getEventsForStream(requestId: string, cursor?: number, limit = 100): {
    events: Array<{
      id: number;
      ts: string;
      source: string;
      type: string;
      level: string;
      message: string;
      attempt?: number;
      data?: Record<string, unknown>;
    }>;
    derived: DerivedSummary;
    artifacts: ArtifactRecord[];
  } | null {
    this.ensureSchema();

    const requestRows = this.sql
      .exec<RequestRow>('SELECT * FROM requests WHERE request_id = ? LIMIT 1', requestId)
      .toArray();
    if (requestRows.length === 0) return null;
    const requestRow = requestRows[0]!;

    const eventQuery = cursor !== undefined
      ? 'SELECT * FROM events WHERE request_id = ? AND id > ? ORDER BY id ASC LIMIT ?'
      : 'SELECT * FROM events WHERE request_id = ? ORDER BY id ASC LIMIT ?';
    const eventArgs = cursor !== undefined ? [requestId, cursor, limit] : [requestId, limit];
    const eventRows = this.sql.exec<EventRow>(eventQuery, ...eventArgs).toArray();

    const artifactRows = this.sql
      .exec<ArtifactRow>('SELECT * FROM artifacts WHERE request_id = ?', requestId)
      .toArray();
    const derived: DerivedSummary = JSON.parse(requestRow.derived_json);

    return {
      events: eventRows.map((row) => ({
        id: row.id,
        ts: row.ts,
        source: row.source,
        type: row.type,
        level: row.level,
        message: row.message,
        attempt: row.attempt ?? undefined,
        data: row.data_json ? (JSON.parse(row.data_json) as Record<string, unknown>) : undefined,
      })),
      derived,
      artifacts: artifactRows.map((row) => ({
        kind: row.kind as ArtifactRecord['kind'],
        r2Key: row.r2_key,
        contentType: row.content_type,
        bytes: row.bytes,
        sha256: row.sha256,
      })),
    };
  }

  /**
   * Get paginated events only.
   * Returns null when this instance holds no row for the request, so the
   * service can fall back to the legacy per-request DO.
   */
  getEvents(
    requestId: string,
    cursor?: number,
    limit = 100
  ): { events: LogEvent[]; nextCursor?: number } | null {
    this.ensureSchema();

    const requestRows = this.sql
      .exec<RequestRow>('SELECT request_id FROM requests WHERE request_id = ? LIMIT 1', requestId)
      .toArray();
    if (requestRows.length === 0) return null;

    const eventQuery = cursor !== undefined
      ? 'SELECT * FROM events WHERE request_id = ? AND id > ? ORDER BY id ASC LIMIT ?'
      : 'SELECT * FROM events WHERE request_id = ? ORDER BY id ASC LIMIT ?';

    const eventArgs = cursor !== undefined ? [requestId, cursor, limit + 1] : [requestId, limit + 1];
    const eventRows = this.sql.exec<EventRow>(eventQuery, ...eventArgs).toArray();

    const hasMore = eventRows.length > limit;
    const events = eventRows.slice(0, limit);
    const nextCursor = hasMore && events.length > 0 ? events[events.length - 1]!.id : undefined;

    return {
      events: events.map((row) => ({
        ts: row.ts,
        source: row.source as LogEvent['source'],
        type: row.type as LogEvent['type'],
        level: row.level as LogEvent['level'],
        message: row.message,
        attempt: row.attempt ?? undefined,
        data: row.data_json ? (JSON.parse(row.data_json) as Record<string, unknown>) : undefined
      })),
      nextCursor
    };
  }
}
