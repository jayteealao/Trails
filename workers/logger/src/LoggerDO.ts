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
import { initSchema } from './schema.js';

interface RequestRow {
  request_id: string;
  url: string;
  created_at: string;
  options_r2_key: string | null;
  manifest_r2_key: string | null;
  external_json: string | null;
  derived_json: string;
}

interface EventRow {
  id: number;
  ts: string;
  source: string;
  type: string;
  level: string;
  message: string;
  attempt: number | null;
  data_json: string | null;
}

interface ArtifactRow {
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

function asNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
  return value;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
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
  }

  if (event.type === 'persist.completed') {
    const durationMs = asNumber(data?.['duration_ms']);
    if (durationMs !== undefined) diagnostics.persistMs = durationMs;
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

export class LoggerDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private initialized = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
  }

  private ensureSchema(): void {
    if (!this.initialized) {
      initSchema(this.sql);
      this.initialized = true;
    }
  }

  /**
   * Initialize a new request record.
   * Idempotent: if request already exists, returns existing data.
   */
  async initRequest(payload: InitRequestPayload): Promise<{ created: boolean }> {
    this.ensureSchema();

    const existing = this.sql
      .exec<RequestRow>('SELECT request_id FROM requests WHERE request_id = ?', payload.requestId)
      .toArray();

    if (existing.length > 0) {
      return { created: false };
    }

    const now = new Date().toISOString();
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

    // Update D1 index (best-effort)
    try {
      await this.env.INDEX_DB.prepare(
        `INSERT INTO requests_index
         (request_id, url, domain, created_at, updated_at, stage)
         VALUES (?, ?, ?, ?, ?, ?)`
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
  async appendEvent(event: LogEvent): Promise<{ eventId: number }> {
    this.ensureSchema();

    // Insert event
    this.sql.exec(
      `INSERT INTO events (ts, source, type, level, message, attempt, data_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      event.ts,
      event.source,
      event.type,
      event.level,
      event.message,
      event.attempt ?? null,
      event.data ? JSON.stringify(event.data) : null
    );

    // Get the inserted event ID
    const lastRow = this.sql.exec<{ id: number }>('SELECT last_insert_rowid() as id').one();
    const eventId = lastRow?.id ?? 0;

    // Update derived summary
    const requestRows = this.sql.exec<RequestRow>('SELECT * FROM requests LIMIT 1').toArray();
    const requestRow = requestRows[0];
    if (requestRow) {
      const derived: DerivedSummary = JSON.parse(requestRow.derived_json);

      // Update stage if event implies a new stage
      const newStage = deriveStage(event.type, event.data);
      if (newStage) {
        derived.stage = newStage;
        derived.terminal = newStage === 'done' || newStage === 'failed';
      }

      // Increment error count for error-level events
      if (event.level === 'error') {
        derived.errorCount++;
      }

      derived.lastEventTs = event.ts;
      derived.diagnostics = updateDiagnostics(derived.diagnostics, event);

      this.sql.exec(
        'UPDATE requests SET derived_json = ? WHERE request_id = ?',
        JSON.stringify(derived),
        requestRow.request_id
      );

      // Update D1 index (best-effort)
      try {
        await this.env.INDEX_DB.prepare(
          `UPDATE requests_index
           SET updated_at = ?, last_event_ts = ?, stage = ?,
               terminal_state = ?, error_count = ?,
               last_error_code = ?, last_error_message = ?, last_error_source = ?,
               retry_count = ?, render_ms = ?, derive_ms = ?, persist_ms = ?,
               last_trace_id = ?
           WHERE request_id = ?`
        )
          .bind(
            new Date().toISOString(),
            event.ts,
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
            requestRow.request_id
          )
          .run();
      } catch (err) {
        console.error(`D1 index update failed for ${requestRow.request_id}:`, err instanceof Error ? err.message : err);
      }
    }

    return { eventId };
  }

  /**
   * Upsert an artifact record.
   * Multiple artifacts of the same kind with different r2_key are allowed.
   */
  upsertArtifact(artifact: ArtifactRecord): void {
    this.ensureSchema();

    this.sql.exec(
      `INSERT OR REPLACE INTO artifacts (kind, r2_key, content_type, bytes, sha256)
       VALUES (?, ?, ?, ?, ?)`,
      artifact.kind,
      artifact.r2Key,
      artifact.contentType,
      artifact.bytes,
      artifact.sha256
    );
  }

  /**
   * Update request fields (manifest_r2_key, external_json).
   */
  async updateRequestFields(patch: RequestFieldsPatch): Promise<void> {
    this.ensureSchema();

    const requestRows = this.sql.exec<RequestRow>('SELECT * FROM requests LIMIT 1').toArray();
    const requestRow = requestRows[0];
    if (!requestRow) {
      throw new Error('Request not found');
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
  }

  /**
   * Get the full canonical view of the request.
   */
  getRequestView(cursor?: number, limit = 100): CanonicalRequestView | null {
    this.ensureSchema();

    const requestRows = this.sql.exec<RequestRow>('SELECT * FROM requests LIMIT 1').toArray();
    if (requestRows.length === 0) {
      return null;
    }
    const requestRow = requestRows[0]!;

    // Get events with pagination
    const eventQuery = cursor !== undefined
      ? 'SELECT * FROM events WHERE id > ? ORDER BY id ASC LIMIT ?'
      : 'SELECT * FROM events ORDER BY id ASC LIMIT ?';

    const eventArgs = cursor !== undefined ? [cursor, limit + 1] : [limit + 1];
    const eventRows = this.sql.exec<EventRow>(eventQuery, ...eventArgs).toArray();

    const hasMore = eventRows.length > limit;
    const events = eventRows.slice(0, limit);
    const nextCursor = hasMore && events.length > 0 ? events[events.length - 1]!.id : undefined;

    // Get all artifacts
    const artifactRows = this.sql.exec<ArtifactRow>('SELECT * FROM artifacts').toArray();

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
  getEventsForStream(cursor?: number, limit = 100): {
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

    const requestRows = this.sql.exec<RequestRow>('SELECT * FROM requests LIMIT 1').toArray();
    if (requestRows.length === 0) return null;
    const requestRow = requestRows[0]!;

    const eventQuery = cursor !== undefined
      ? 'SELECT * FROM events WHERE id > ? ORDER BY id ASC LIMIT ?'
      : 'SELECT * FROM events ORDER BY id ASC LIMIT ?';
    const eventArgs = cursor !== undefined ? [cursor, limit] : [limit];
    const eventRows = this.sql.exec<EventRow>(eventQuery, ...eventArgs).toArray();

    const artifactRows = this.sql.exec<ArtifactRow>('SELECT * FROM artifacts').toArray();
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
   */
  getEvents(cursor?: number, limit = 100): { events: LogEvent[]; nextCursor?: number } {
    this.ensureSchema();

    const eventQuery = cursor !== undefined
      ? 'SELECT * FROM events WHERE id > ? ORDER BY id ASC LIMIT ?'
      : 'SELECT * FROM events ORDER BY id ASC LIMIT ?';

    const eventArgs = cursor !== undefined ? [cursor, limit + 1] : [limit + 1];
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
