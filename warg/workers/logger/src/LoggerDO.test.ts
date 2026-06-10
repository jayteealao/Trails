import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import type {
  InitRequestPayload,
  LogEvent,
  ArtifactRecord,
  CanonicalRequestView,
  DerivedSummary,
  RequestFieldsPatch
} from '@warg/shared';
import { bucketKeyForTs } from './index.js';

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
  initRequest(payload: InitRequestPayload, createdAt?: string): Promise<{ created: boolean }>;
  appendEvent(requestId: string, event: LogEvent): Promise<{ eventId: number }>;
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

/**
 * Helper to get a DO stub by instance key (bucket key or legacy request id).
 */
function getStub(key: string): LoggerStub {
  const id = env.LOGGER_DO.idFromName(key);
  return env.LOGGER_DO.get(id) as unknown as LoggerStub;
}

function infoEvent(type: LogEvent['type'], message: string, data?: Record<string, unknown>): LogEvent {
  return {
    ts: new Date().toISOString(),
    source: 'workflow',
    type,
    level: 'info',
    message,
    ...(data ? { data } : {})
  };
}

describe('bucketKeyForTs', () => {
  it('buckets by UTC hour', () => {
    expect(bucketKeyForTs('2026-12-09T23:59:59Z')).toBe('bucket:2026120923');
    expect(bucketKeyForTs('2026-06-10T00:00:00.000Z')).toBe('bucket:2026061000');
    expect(bucketKeyForTs('2026-06-10T00:59:59.999Z')).toBe('bucket:2026061000');
  });

  it('normalizes zoned timestamps to UTC', () => {
    expect(bucketKeyForTs('2026-01-05T07:30:00+01:00')).toBe('bucket:2026010506');
  });
});

describe('LoggerDO', () => {
  describe('initRequest', () => {
    it('creates a new request record', async () => {
      const requestId = `test-${Date.now()}-1`;
      const stub = getStub('bucket:2026060910');

      const result = await stub.initRequest({
        requestId,
        url: 'https://example.com/page',
        optionsR2Key: 'archives/test/input/options.json'
      });

      expect(result.created).toBe(true);
    });

    it('is idempotent for existing requests', async () => {
      const requestId = `test-${Date.now()}-2`;
      const stub = getStub('bucket:2026060910');

      const payload: InitRequestPayload = {
        requestId,
        url: 'https://example.com/page'
      };

      const first = await stub.initRequest(payload);
      const second = await stub.initRequest(payload);

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
    });

    it('stores the service-supplied createdAt', async () => {
      const requestId = `test-${Date.now()}-2b`;
      const createdAt = '2026-06-09T14:30:00.000Z';
      const stub = getStub(bucketKeyForTs(createdAt));

      await stub.initRequest({ requestId, url: 'https://example.com' }, createdAt);

      const view = await stub.getRequestView(requestId);
      expect(view?.createdAt).toBe(createdAt);
    });
  });

  describe('hour-bucket keying (multi-request instance)', () => {
    it('isolates events, artifacts, and derived state per request', async () => {
      const stub = getStub('bucket:2026060914');
      const reqA = `bucket-test-${Date.now()}-a`;
      const reqB = `bucket-test-${Date.now()}-b`;

      await stub.initRequest({ requestId: reqA, url: 'https://example.com/a' });
      await stub.initRequest({ requestId: reqB, url: 'https://example.com/b' });

      await stub.appendEvent(reqA, infoEvent('step.started', 'Render A', { step: 'render' }));
      await stub.appendEvent(reqA, {
        ts: new Date().toISOString(),
        source: 'workflow',
        type: 'artifact.written',
        level: 'info',
        message: 'Artifact written: rendered.html',
        data: {
          kind: 'rendered.html',
          r2Key: `archives/${reqA}/raw/rendered.html`,
          bytes: 100,
          contentType: 'text/html',
          sha256: 'sha-a'
        }
      });
      await stub.appendEvent(reqA, infoEvent('request.done', 'Done A'));
      await stub.appendEvent(reqB, infoEvent('step.started', 'Render B', { step: 'render' }));

      const viewA = await stub.getRequestView(reqA);
      expect(viewA?.requestId).toBe(reqA);
      expect(viewA?.events).toHaveLength(3);
      expect(viewA?.events.some((e) => e.message === 'Render B')).toBe(false);
      expect(viewA?.artifacts).toHaveLength(1);
      expect(viewA?.artifacts[0]?.r2Key).toContain(reqA);
      expect(viewA?.derived.stage).toBe('done');
      expect(viewA?.derived.terminal).toBe(true);

      const viewB = await stub.getRequestView(reqB);
      expect(viewB?.events).toHaveLength(1);
      expect(viewB?.artifacts).toHaveLength(0);
      expect(viewB?.derived.stage).toBe('rendering');
      expect(viewB?.derived.terminal).toBe(false);

      const streamB = await stub.getEventsForStream(reqB);
      expect(streamB?.events).toHaveLength(1);
      expect(streamB?.events[0]?.message).toBe('Render B');

      const eventsA = await stub.getEvents(reqA);
      expect(eventsA?.events).toHaveLength(3);
    });

    it('returns null for requests this bucket does not hold (dual-read contract)', async () => {
      const stub = getStub('bucket:2026060915');

      expect(await stub.getRequestView('missing-req')).toBeNull();
      expect(await stub.getEventsForStream('missing-req')).toBeNull();
      expect(await stub.getEvents('missing-req')).toBeNull();
      expect((await stub.updateRequestFields('missing-req', { manifestR2Key: 'x' })).updated).toBe(
        false
      );
    });
  });

  describe('legacy per-request instance migration', () => {
    it('adopts pre-bucket rows under the single request id and serves filtered reads', async () => {
      const requestId = `legacy-${Date.now()}`;
      const id = env.LOGGER_DO.idFromName(requestId);
      const rawStub = env.LOGGER_DO.get(id);

      // Recreate a pre-bucket instance exactly as the old schema wrote it:
      // no request_id column on events/artifacts, one request per instance.
      await runInDurableObject(rawStub, async (_instance, state) => {
        const sql = state.storage.sql;
        sql.exec(`
          CREATE TABLE IF NOT EXISTS requests (
            request_id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            created_at TEXT NOT NULL,
            options_r2_key TEXT,
            manifest_r2_key TEXT,
            external_json TEXT,
            derived_json TEXT NOT NULL DEFAULT '{}'
          );

          CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL,
            source TEXT NOT NULL,
            type TEXT NOT NULL,
            level TEXT NOT NULL,
            message TEXT NOT NULL,
            attempt INTEGER,
            data_json TEXT
          );

          CREATE TABLE IF NOT EXISTS artifacts (
            kind TEXT NOT NULL,
            r2_key TEXT NOT NULL,
            content_type TEXT NOT NULL,
            bytes INTEGER NOT NULL,
            sha256 TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (kind, r2_key)
          );
        `);
        sql.exec(
          `INSERT INTO requests (request_id, url, created_at, derived_json) VALUES (?, ?, ?, ?)`,
          requestId,
          'https://example.com/legacy',
          '2026-05-01T10:00:00.000Z',
          JSON.stringify({ stage: 'done', errorCount: 0, terminal: true })
        );
        sql.exec(
          `INSERT INTO events (ts, source, type, level, message) VALUES (?, 'gateway', 'request.created', 'info', 'created')`,
          '2026-05-01T10:00:00.000Z'
        );
        sql.exec(
          `INSERT INTO events (ts, source, type, level, message) VALUES (?, 'workflow', 'request.done', 'info', 'done')`,
          '2026-05-01T10:01:00.000Z'
        );
        sql.exec(
          `INSERT INTO artifacts (kind, r2_key, content_type, bytes, sha256) VALUES ('rendered.html', ?, 'text/html', 10, 'sha-legacy')`,
          `archives/${requestId}/raw/rendered.html`
        );
      });

      // First read triggers ensureSchema → migrateSchema, which adds the
      // request_id columns and backfills them from the single requests row.
      const stub = rawStub as unknown as LoggerStub;
      const view = await stub.getRequestView(requestId);

      expect(view).not.toBeNull();
      expect(view?.requestId).toBe(requestId);
      expect(view?.events).toHaveLength(2);
      expect(view?.events[1]?.type).toBe('request.done');
      expect(view?.artifacts).toHaveLength(1);
      expect(view?.artifacts[0]?.sha256).toBe('sha-legacy');
      expect(view?.derived.terminal).toBe(true);

      const stream = await stub.getEventsForStream(requestId);
      expect(stream?.events).toHaveLength(2);
    });
  });

  describe('appendEvent', () => {
    it('inserts events and returns event ID', async () => {
      const requestId = `test-${Date.now()}-3`;
      const stub = getStub('bucket:2026060911');

      await stub.initRequest({ requestId, url: 'https://example.com' });

      const event: LogEvent = {
        ts: new Date().toISOString(),
        source: 'gateway',
        type: 'request.created',
        level: 'info',
        message: 'Request created'
      };

      const result = await stub.appendEvent(requestId, event);
      expect(result.eventId).toBeGreaterThan(0);
    });

    it('increments error count for error-level events', async () => {
      const requestId = `test-${Date.now()}-4`;
      const stub = getStub('bucket:2026060911');

      await stub.initRequest({ requestId, url: 'https://example.com' });

      const errorEvent: LogEvent = {
        ts: new Date().toISOString(),
        source: 'renderer',
        type: 'step.failed',
        level: 'error',
        message: 'Rendering failed',
        data: { reason: 'timeout' }
      };

      await stub.appendEvent(requestId, errorEvent);

      const view = await stub.getRequestView(requestId);
      expect(view?.derived.errorCount).toBe(1);
    });

    it('updates stage from event type', async () => {
      const requestId = `test-${Date.now()}-5`;
      const stub = getStub('bucket:2026060911');

      await stub.initRequest({ requestId, url: 'https://example.com' });

      {
        const view1 = await stub.getRequestView(requestId);
        expect(view1?.derived.stage).toBe('queued');
      }

      // step.started with step=render → rendering
      await stub.appendEvent(requestId, {
        ts: new Date().toISOString(),
        source: 'workflow',
        type: 'step.started',
        level: 'info',
        message: 'Renderer step started',
        data: { step: 'render' }
      });

      {
        const view2 = await stub.getRequestView(requestId);
        expect(view2?.derived.stage).toBe('rendering');
      }

      // step.started with step=derivatives → deriving
      await stub.appendEvent(requestId, {
        ts: new Date().toISOString(),
        source: 'workflow',
        type: 'step.started',
        level: 'info',
        message: 'Derivatives step started',
        data: { step: 'derivatives' }
      });

      {
        const view2b = await stub.getRequestView(requestId);
        expect(view2b?.derived.stage).toBe('deriving');
      }

      await stub.appendEvent(requestId, {
        ts: new Date().toISOString(),
        source: 'gcs',
        type: 'persist.started',
        level: 'info',
        message: 'Persisting to GCS'
      });

      {
        const view3 = await stub.getRequestView(requestId);
        expect(view3?.derived.stage).toBe('persisting');
      }

      await stub.appendEvent(requestId, {
        ts: new Date().toISOString(),
        source: 'workflow',
        type: 'request.done',
        level: 'info',
        message: 'Request completed'
      });

      {
        const view4 = await stub.getRequestView(requestId);
        expect(view4?.derived.stage).toBe('done');
        expect(view4?.derived.terminal).toBe(true);
      }
    });

    it('stores diagnostics fields for errors and durations', async () => {
      const requestId = `test-${Date.now()}-5b`;
      const stub = getStub('bucket:2026060912');

      await stub.initRequest({ requestId, url: 'https://example.com' });

      await stub.appendEvent(requestId, {
        ts: new Date().toISOString(),
        source: 'workflow',
        type: 'step.completed',
        level: 'info',
        message: 'Step completed: render',
        data: {
          step: 'render',
          duration_ms: 1200,
          fallbackUsed: true,
          fallbackReason: 'browser_rendering_403',
          fallbackProvider: 'hyperbrowser',
        },
      });

      await stub.appendEvent(requestId, {
        ts: new Date().toISOString(),
        source: 'workflow',
        type: 'step.completed',
        level: 'info',
        message: 'Step completed: readability',
        data: { step: 'readability', duration_ms: 850 },
      });

      await stub.appendEvent(requestId, {
        ts: new Date().toISOString(),
        source: 'gcs',
        type: 'persist.completed',
        level: 'info',
        message: 'GCS persistence completed',
        data: { duration_ms: 4000 },
      });

      await stub.appendEvent(requestId, {
        ts: new Date().toISOString(),
        source: 'renderer',
        type: 'step.failed',
        level: 'error',
        message: 'Render failed',
        attempt: 2,
        data: {
          errorCode: 'RENDER_TIMEOUT',
          retryable: true,
          recommendedAction: 'retry_full',
          traceId: 'trace_123',
          error: 'Timed out in render service',
        },
      });

      await stub.appendEvent(requestId, {
        ts: new Date().toISOString(),
        source: 'workflow',
        type: 'workflow.completed',
        level: 'info',
        message: 'Workflow completed',
        data: {
          degraded: true,
          partialFailures: [{ step: 'singlefile', error: 'singlefile timeout' }],
        },
      });

      const view = await stub.getRequestView(requestId);
      expect(view?.derived.diagnostics?.errorCode).toBe('RENDER_TIMEOUT');
      expect(view?.derived.diagnostics?.errorSource).toBe('renderer');
      expect(view?.derived.diagnostics?.retryable).toBe(true);
      expect(view?.derived.diagnostics?.recommendedAction).toBe('retry_full');
      expect(view?.derived.diagnostics?.retryCount).toBe(2);
      expect(view?.derived.diagnostics?.renderMs).toBe(1200);
      expect(view?.derived.diagnostics?.deriveMs).toBe(850);
      expect(view?.derived.diagnostics?.persistMs).toBe(4000);
      expect(view?.derived.diagnostics?.lastTraceId).toBe('trace_123');
      expect(view?.derived.diagnostics?.renderProvider).toBe('hyperbrowser');
      expect(view?.derived.diagnostics?.renderFallbackUsed).toBe(true);
      expect(view?.derived.diagnostics?.renderFallbackReason).toBe('browser_rendering_403');
      expect(view?.derived.diagnostics?.degraded).toBe(true);
      expect(view?.derived.diagnostics?.degradedSteps).toEqual(['singlefile']);
    });

    it('marks stage as incomplete when workflow completes with degraded monolith output', async () => {
      const requestId = `test-${Date.now()}-5c-incomplete`;
      const stub = getStub('bucket:2026060912');

      await stub.initRequest({ requestId, url: 'https://example.com' });

      await stub.appendEvent(requestId, {
        ts: new Date().toISOString(),
        source: 'workflow',
        type: 'workflow.completed',
        level: 'info',
        message: 'Workflow completed with monolith degraded',
        data: {
          degraded: true,
          degradedSteps: ['monolith'],
        },
      });

      const view = await stub.getRequestView(requestId);
      expect(view?.derived.stage).toBe('incomplete');
      expect(view?.derived.terminal).toBe(true);
      expect(view?.derived.diagnostics?.degraded).toBe(true);
      expect(view?.derived.diagnostics?.degradedSteps).toEqual(['monolith']);
    });

    it('treats workflow.failed as terminal fallback and allows retry to reopen stage', async () => {
      const requestId = `test-${Date.now()}-5c`;
      const stub = getStub('bucket:2026060912');

      await stub.initRequest({ requestId, url: 'https://example.com' });

      await stub.appendEvent(requestId, {
        ts: new Date().toISOString(),
        source: 'workflow',
        type: 'step.started',
        level: 'info',
        message: 'Derivatives step started',
        data: { step: 'derivatives' }
      });

      {
        const view1 = await stub.getRequestView(requestId);
        expect(view1?.derived.stage).toBe('deriving');
        expect(view1?.derived.terminal).toBe(false);
      }

      await stub.appendEvent(requestId, {
        ts: new Date().toISOString(),
        source: 'workflow',
        type: 'workflow.failed',
        level: 'error',
        message: 'Workflow failed: timeout'
      });

      {
        const view2 = await stub.getRequestView(requestId);
        expect(view2?.derived.stage).toBe('failed');
        expect(view2?.derived.terminal).toBe(true);
      }

      await stub.appendEvent(requestId, {
        ts: new Date().toISOString(),
        source: 'gateway',
        type: 'request.created',
        level: 'info',
        message: 'Archive request created'
      });

      {
        const view3 = await stub.getRequestView(requestId);
        expect(view3?.derived.stage).toBe('queued');
        expect(view3?.derived.terminal).toBe(false);
      }
    });

    it('treats workflow.completed as done fallback when request.done is missing', async () => {
      const requestId = `test-${Date.now()}-5d`;
      const stub = getStub('bucket:2026060913');

      await stub.initRequest({ requestId, url: 'https://example.com' });

      await stub.appendEvent(requestId, {
        ts: new Date().toISOString(),
        source: 'workflow',
        type: 'workflow.completed',
        level: 'info',
        message: 'Workflow completed'
      });

      const view = await stub.getRequestView(requestId);
      expect(view?.derived.stage).toBe('done');
      expect(view?.derived.terminal).toBe(true);
    });

    it('materializes artifacts from artifact.written events when metadata is complete', async () => {
      const requestId = `test-${Date.now()}-5e`;
      const stub = getStub('bucket:2026060913');

      await stub.initRequest({ requestId, url: 'https://example.com' });

      await stub.appendEvent(requestId, {
        ts: new Date().toISOString(),
        source: 'workflow',
        type: 'artifact.written',
        level: 'info',
        message: 'Artifact written: rendered.html',
        data: {
          kind: 'rendered.html',
          r2Key: `archives/${requestId}/raw/rendered.html`,
          bytes: 321,
          contentType: 'text/html',
          sha256: 'sha-rendered',
        },
      });

      const view = await stub.getRequestView(requestId);
      expect(view?.artifacts).toHaveLength(1);
      expect(view?.artifacts[0]?.kind).toBe('rendered.html');
      expect(view?.artifacts[0]?.bytes).toBe(321);
      expect(view?.artifacts[0]?.sha256).toBe('sha-rendered');
    });

    it('ignores artifact.written events with incomplete metadata', async () => {
      const requestId = `test-${Date.now()}-5f`;
      const stub = getStub('bucket:2026060913');

      await stub.initRequest({ requestId, url: 'https://example.com' });

      await stub.appendEvent(requestId, {
        ts: new Date().toISOString(),
        source: 'workflow',
        type: 'artifact.written',
        level: 'info',
        message: 'Artifact written: rendered.html',
        data: {
          kind: 'rendered.html',
          r2Key: `archives/${requestId}/raw/rendered.html`,
          bytes: 654,
        },
      });

      const view = await stub.getRequestView(requestId);
      expect(view?.artifacts).toHaveLength(0);
    });
  });

  describe('upsertArtifact', () => {
    it('inserts a new artifact', async () => {
      const requestId = `test-${Date.now()}-6`;
      const stub = getStub('bucket:2026060916');

      await stub.initRequest({ requestId, url: 'https://example.com' });

      const artifact: ArtifactRecord = {
        kind: 'rendered.html',
        r2Key: `archives/${requestId}/raw/rendered.html`,
        contentType: 'text/html',
        bytes: 12345,
        sha256: 'abc123'
      };

      await stub.upsertArtifact(requestId, artifact);

      const view = await stub.getRequestView(requestId);
      expect(view?.artifacts).toHaveLength(1);
      expect(view?.artifacts[0]?.kind).toBe('rendered.html');
      expect(view?.artifacts[0]?.bytes).toBe(12345);
    });

    it('replaces artifact on conflict (same kind + r2_key)', async () => {
      const requestId = `test-${Date.now()}-7`;
      const stub = getStub('bucket:2026060916');

      await stub.initRequest({ requestId, url: 'https://example.com' });

      const artifact1: ArtifactRecord = {
        kind: 'rendered.html',
        r2Key: `archives/${requestId}/raw/rendered.html`,
        contentType: 'text/html',
        bytes: 100,
        sha256: 'first'
      };

      const artifact2: ArtifactRecord = {
        kind: 'rendered.html',
        r2Key: `archives/${requestId}/raw/rendered.html`,
        contentType: 'text/html',
        bytes: 200,
        sha256: 'second'
      };

      await stub.upsertArtifact(requestId, artifact1);
      await stub.upsertArtifact(requestId, artifact2);

      const view = await stub.getRequestView(requestId);
      expect(view?.artifacts).toHaveLength(1);
      expect(view?.artifacts[0]?.bytes).toBe(200);
      expect(view?.artifacts[0]?.sha256).toBe('second');
    });
  });

  describe('updateRequestFields', () => {
    it('updates manifest_r2_key', async () => {
      const requestId = `test-${Date.now()}-8`;
      const stub = getStub('bucket:2026060917');

      await stub.initRequest({ requestId, url: 'https://example.com' });

      const result = await stub.updateRequestFields(requestId, {
        manifestR2Key: `archives/${requestId}/manifest.json`
      });
      expect(result.updated).toBe(true);

      const view = await stub.getRequestView(requestId);
      expect(view?.manifestR2Key).toBe(`archives/${requestId}/manifest.json`);
    });

    it('updates external_json', async () => {
      const requestId = `test-${Date.now()}-9`;
      const stub = getStub('bucket:2026060917');

      await stub.initRequest({ requestId, url: 'https://example.com' });

      const result = await stub.updateRequestFields(requestId, {
        externalJson: { firestoreDocId: 'doc123', gcsPath: 'gs://bucket/path' }
      });
      expect(result.updated).toBe(true);

      const view = await stub.getRequestView(requestId);
      expect(view?.externalJson).toEqual({
        firestoreDocId: 'doc123',
        gcsPath: 'gs://bucket/path'
      });
    });
  });

  describe('getRequestView', () => {
    it('returns null for non-existent request', async () => {
      const requestId = `test-nonexistent-${Date.now()}`;
      const stub = getStub('bucket:2026060918');

      const view = await stub.getRequestView(requestId);
      expect(view).toBeNull();
    });

    it('returns full view with events and artifacts', async () => {
      const requestId = `test-${Date.now()}-10`;
      const stub = getStub('bucket:2026060918');

      await stub.initRequest({
        requestId,
        url: 'https://example.com/article',
        optionsR2Key: `archives/${requestId}/input/options.json`
      });

      await stub.appendEvent(requestId, {
        ts: new Date().toISOString(),
        source: 'gateway',
        type: 'request.created',
        level: 'info',
        message: 'Request created'
      });

      await stub.upsertArtifact(requestId, {
        kind: 'screenshot.png',
        r2Key: `archives/${requestId}/raw/screenshot.png`,
        contentType: 'image/png',
        bytes: 50000,
        sha256: 'screenshotsha'
      });

      const view = await stub.getRequestView(requestId);

      expect(view).not.toBeNull();
      expect(view?.requestId).toBe(requestId);
      expect(view?.url).toBe('https://example.com/article');
      expect(view?.optionsR2Key).toBe(`archives/${requestId}/input/options.json`);
      expect(view?.events).toHaveLength(1);
      expect(view?.events[0]?.type).toBe('request.created');
      expect(view?.artifacts).toHaveLength(1);
      expect(view?.artifacts[0]?.kind).toBe('screenshot.png');
    });

    it('paginates events', async () => {
      const requestId = `test-${Date.now()}-11`;
      const stub = getStub('bucket:2026060919');

      await stub.initRequest({ requestId, url: 'https://example.com' });

      // Add 5 events
      for (let i = 0; i < 5; i++) {
        await stub.appendEvent(requestId, {
          ts: new Date().toISOString(),
          source: 'workflow',
          type: 'step.started',
          level: 'info',
          message: `Step ${i + 1}`
        });
      }

      let nextCursor: number | undefined;

      // Get first page (limit 2)
      {
        const page1 = await stub.getRequestView(requestId, undefined, 2);
        expect(page1?.events).toHaveLength(2);
        expect(page1?.nextCursor).toBeDefined();
        nextCursor = page1?.nextCursor;
      }

      // Get second page
      {
        const page2 = await stub.getRequestView(requestId, nextCursor, 2);
        expect(page2?.events).toHaveLength(2);
        expect(page2?.nextCursor).toBeDefined();
        nextCursor = page2?.nextCursor;
      }

      // Get third page (only 1 remaining)
      {
        const page3 = await stub.getRequestView(requestId, nextCursor, 2);
        expect(page3?.events).toHaveLength(1);
        expect(page3?.nextCursor).toBeUndefined();
      }
    });
  });

  describe('getEvents', () => {
    it('returns paginated events only', async () => {
      const requestId = `test-${Date.now()}-12`;
      const stub = getStub('bucket:2026060920');

      await stub.initRequest({ requestId, url: 'https://example.com' });

      for (let i = 0; i < 3; i++) {
        await stub.appendEvent(requestId, {
          ts: new Date().toISOString(),
          source: 'workflow',
          type: 'step.completed',
          level: 'info',
          message: `Completed step ${i + 1}`
        });
      }

      let nextCursor: number | undefined;

      {
        const result = await stub.getEvents(requestId, undefined, 2);
        expect(result?.events).toHaveLength(2);
        expect(result?.nextCursor).toBeDefined();
        nextCursor = result?.nextCursor;
      }

      {
        const result2 = await stub.getEvents(requestId, nextCursor, 2);
        expect(result2?.events).toHaveLength(1);
        expect(result2?.nextCursor).toBeUndefined();
      }
    });
  });
});
