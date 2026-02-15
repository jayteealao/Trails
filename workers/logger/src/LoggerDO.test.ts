import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import type {
  InitRequestPayload,
  LogEvent,
  ArtifactRecord
} from '@warg/shared';
import { LoggerDO } from './LoggerDO.js';

/**
 * Helper to get a fresh DO stub for testing.
 */
function getStub(requestId: string): DurableObjectStub<LoggerDO> {
  const id = env.LOGGER_DO.idFromName(requestId);
  return env.LOGGER_DO.get(id);
}

describe('LoggerDO', () => {
  describe('initRequest', () => {
    it('creates a new request record', async () => {
      const requestId = `test-${Date.now()}-1`;
      const stub = getStub(requestId);

      using result = await stub.initRequest({
        requestId,
        url: 'https://example.com/page',
        optionsR2Key: 'archives/test/input/options.json'
      });

      expect(result.created).toBe(true);
    });

    it('is idempotent for existing requests', async () => {
      const requestId = `test-${Date.now()}-2`;
      const stub = getStub(requestId);

      const payload: InitRequestPayload = {
        requestId,
        url: 'https://example.com/page'
      };

      using first = await stub.initRequest(payload);
      using second = await stub.initRequest(payload);

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
    });
  });

  describe('appendEvent', () => {
    it('inserts events and returns event ID', async () => {
      const requestId = `test-${Date.now()}-3`;
      const stub = getStub(requestId);

      await stub.initRequest({ requestId, url: 'https://example.com' });

      const event: LogEvent = {
        ts: new Date().toISOString(),
        source: 'gateway',
        type: 'request.created',
        level: 'info',
        message: 'Request created'
      };

      using result = await stub.appendEvent(event);
      expect(result.eventId).toBeGreaterThan(0);
    });

    it('increments error count for error-level events', async () => {
      const requestId = `test-${Date.now()}-4`;
      const stub = getStub(requestId);

      await stub.initRequest({ requestId, url: 'https://example.com' });

      const errorEvent: LogEvent = {
        ts: new Date().toISOString(),
        source: 'renderer',
        type: 'step.failed',
        level: 'error',
        message: 'Rendering failed',
        data: { reason: 'timeout' }
      };

      await stub.appendEvent(errorEvent);

      using view = await stub.getRequestView();
      expect(view?.derived.errorCount).toBe(1);
    });

    it('updates stage from event type', async () => {
      const requestId = `test-${Date.now()}-5`;
      const stub = getStub(requestId);

      await stub.initRequest({ requestId, url: 'https://example.com' });

      {
        using view1 = await stub.getRequestView();
        expect(view1?.derived.stage).toBe('queued');
      }

      // step.started with step=render → rendering
      await stub.appendEvent({
        ts: new Date().toISOString(),
        source: 'workflow',
        type: 'step.started',
        level: 'info',
        message: 'Renderer step started',
        data: { step: 'render' }
      });

      {
        using view2 = await stub.getRequestView();
        expect(view2?.derived.stage).toBe('rendering');
      }

      // step.started with step=derivatives → deriving
      await stub.appendEvent({
        ts: new Date().toISOString(),
        source: 'workflow',
        type: 'step.started',
        level: 'info',
        message: 'Derivatives step started',
        data: { step: 'derivatives' }
      });

      {
        using view2b = await stub.getRequestView();
        expect(view2b?.derived.stage).toBe('deriving');
      }

      await stub.appendEvent({
        ts: new Date().toISOString(),
        source: 'gcs',
        type: 'persist.started',
        level: 'info',
        message: 'Persisting to GCS'
      });

      {
        using view3 = await stub.getRequestView();
        expect(view3?.derived.stage).toBe('persisting');
      }

      await stub.appendEvent({
        ts: new Date().toISOString(),
        source: 'workflow',
        type: 'request.done',
        level: 'info',
        message: 'Request completed'
      });

      {
        using view4 = await stub.getRequestView();
        expect(view4?.derived.stage).toBe('done');
        expect(view4?.derived.terminal).toBe(true);
      }
    });

    it('stores diagnostics fields for errors and durations', async () => {
      const requestId = `test-${Date.now()}-5b`;
      const stub = getStub(requestId);

      await stub.initRequest({ requestId, url: 'https://example.com' });

      await stub.appendEvent({
        ts: new Date().toISOString(),
        source: 'workflow',
        type: 'step.completed',
        level: 'info',
        message: 'Step completed: render',
        data: { step: 'render', duration_ms: 1200 },
      });

      await stub.appendEvent({
        ts: new Date().toISOString(),
        source: 'workflow',
        type: 'step.completed',
        level: 'info',
        message: 'Step completed: readability',
        data: { step: 'readability', duration_ms: 850 },
      });

      await stub.appendEvent({
        ts: new Date().toISOString(),
        source: 'gcs',
        type: 'persist.completed',
        level: 'info',
        message: 'GCS persistence completed',
        data: { duration_ms: 4000 },
      });

      await stub.appendEvent({
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

      using view = await stub.getRequestView();
      expect(view?.derived.diagnostics?.errorCode).toBe('RENDER_TIMEOUT');
      expect(view?.derived.diagnostics?.errorSource).toBe('renderer');
      expect(view?.derived.diagnostics?.retryable).toBe(true);
      expect(view?.derived.diagnostics?.recommendedAction).toBe('retry_full');
      expect(view?.derived.diagnostics?.retryCount).toBe(2);
      expect(view?.derived.diagnostics?.renderMs).toBe(1200);
      expect(view?.derived.diagnostics?.deriveMs).toBe(850);
      expect(view?.derived.diagnostics?.persistMs).toBe(4000);
      expect(view?.derived.diagnostics?.lastTraceId).toBe('trace_123');
    });
  });

  describe('upsertArtifact', () => {
    it('inserts a new artifact', async () => {
      const requestId = `test-${Date.now()}-6`;
      const stub = getStub(requestId);

      await stub.initRequest({ requestId, url: 'https://example.com' });

      const artifact: ArtifactRecord = {
        kind: 'rendered.html',
        r2Key: `archives/${requestId}/raw/rendered.html`,
        contentType: 'text/html',
        bytes: 12345,
        sha256: 'abc123'
      };

      await stub.upsertArtifact(artifact);

      using view = await stub.getRequestView();
      expect(view?.artifacts).toHaveLength(1);
      expect(view?.artifacts[0]?.kind).toBe('rendered.html');
      expect(view?.artifacts[0]?.bytes).toBe(12345);
    });

    it('replaces artifact on conflict (same kind + r2_key)', async () => {
      const requestId = `test-${Date.now()}-7`;
      const stub = getStub(requestId);

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

      await stub.upsertArtifact(artifact1);
      await stub.upsertArtifact(artifact2);

      using view = await stub.getRequestView();
      expect(view?.artifacts).toHaveLength(1);
      expect(view?.artifacts[0]?.bytes).toBe(200);
      expect(view?.artifacts[0]?.sha256).toBe('second');
    });
  });

  describe('updateRequestFields', () => {
    it('updates manifest_r2_key', async () => {
      const requestId = `test-${Date.now()}-8`;
      const stub = getStub(requestId);

      await stub.initRequest({ requestId, url: 'https://example.com' });

      await stub.updateRequestFields({
        manifestR2Key: `archives/${requestId}/manifest.json`
      });

      using view = await stub.getRequestView();
      expect(view?.manifestR2Key).toBe(`archives/${requestId}/manifest.json`);
    });

    it('updates external_json', async () => {
      const requestId = `test-${Date.now()}-9`;
      const stub = getStub(requestId);

      await stub.initRequest({ requestId, url: 'https://example.com' });

      await stub.updateRequestFields({
        externalJson: { firestoreDocId: 'doc123', gcsPath: 'gs://bucket/path' }
      });

      using view = await stub.getRequestView();
      expect(view?.externalJson).toEqual({
        firestoreDocId: 'doc123',
        gcsPath: 'gs://bucket/path'
      });
    });
  });

  describe('getRequestView', () => {
    it('returns null for non-existent request', async () => {
      const requestId = `test-nonexistent-${Date.now()}`;
      const stub = getStub(requestId);

      using view = await stub.getRequestView();
      expect(view).toBeNull();
    });

    it('returns full view with events and artifacts', async () => {
      const requestId = `test-${Date.now()}-10`;
      const stub = getStub(requestId);

      await stub.initRequest({
        requestId,
        url: 'https://example.com/article',
        optionsR2Key: `archives/${requestId}/input/options.json`
      });

      await stub.appendEvent({
        ts: new Date().toISOString(),
        source: 'gateway',
        type: 'request.created',
        level: 'info',
        message: 'Request created'
      });

      await stub.upsertArtifact({
        kind: 'screenshot.png',
        r2Key: `archives/${requestId}/raw/screenshot.png`,
        contentType: 'image/png',
        bytes: 50000,
        sha256: 'screenshotsha'
      });

      using view = await stub.getRequestView();

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
      const stub = getStub(requestId);

      await stub.initRequest({ requestId, url: 'https://example.com' });

      // Add 5 events
      for (let i = 0; i < 5; i++) {
        await stub.appendEvent({
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
        using page1 = await stub.getRequestView(undefined, 2);
        expect(page1?.events).toHaveLength(2);
        expect(page1?.nextCursor).toBeDefined();
        nextCursor = page1?.nextCursor;
      }

      // Get second page
      {
        using page2 = await stub.getRequestView(nextCursor, 2);
        expect(page2?.events).toHaveLength(2);
        expect(page2?.nextCursor).toBeDefined();
        nextCursor = page2?.nextCursor;
      }

      // Get third page (only 1 remaining)
      {
        using page3 = await stub.getRequestView(nextCursor, 2);
        expect(page3?.events).toHaveLength(1);
        expect(page3?.nextCursor).toBeUndefined();
      }
    });
  });

  describe('getEvents', () => {
    it('returns paginated events only', async () => {
      const requestId = `test-${Date.now()}-12`;
      const stub = getStub(requestId);

      await stub.initRequest({ requestId, url: 'https://example.com' });

      for (let i = 0; i < 3; i++) {
        await stub.appendEvent({
          ts: new Date().toISOString(),
          source: 'workflow',
          type: 'step.completed',
          level: 'info',
          message: `Completed step ${i + 1}`
        });
      }

      let nextCursor: number | undefined;

      {
        using result = await stub.getEvents(undefined, 2);
        expect(result.events).toHaveLength(2);
        expect(result.nextCursor).toBeDefined();
        nextCursor = result.nextCursor;
      }

      {
        using result2 = await stub.getEvents(nextCursor, 2);
        expect(result2.events).toHaveLength(1);
        expect(result2.nextCursor).toBeUndefined();
      }
    });
  });
});
