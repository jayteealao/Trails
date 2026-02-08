import type {
  InitRequestPayload,
  LogEvent,
  ArtifactRecord,
  RequestFieldsPatch
} from '@warg/shared';
import { timingSafeEqual } from '@warg/shared';
import { LoggerDO } from './LoggerDO.js';

export { LoggerDO };

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
}

/**
 * Verify internal API key.
 */
function verifyApiKey(request: Request, env: Env): boolean {
  const apiKey = request.headers.get('X-Internal-API-Key');
  if (!apiKey) return false;
  return timingSafeEqual(apiKey, env.INTERNAL_API_KEY);
}

/**
 * Get DO stub for a request ID.
 */
function getLoggerStub(env: Env, requestId: string): DurableObjectStub<LoggerDO> {
  const id = env.LOGGER_DO.idFromName(requestId);
  return env.LOGGER_DO.get(id);
}

/**
 * Parse URL pathname and params.
 */
function parseRoute(
  url: URL
): { path: string; requestId?: string; params: URLSearchParams } {
  const path = url.pathname;
  const params = url.searchParams;

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
  async fetch(request: Request, env: Env): Promise<Response> {
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
        const stub = getLoggerStub(env, payload.requestId);
        const result = await stub.initRequest(payload);
        return Response.json(result, { status: result.created ? 201 : 200 });
      }

      // POST /event - Append an event (requires requestId in body)
      if (method === 'POST' && path === '/event') {
        const body = (await request.json()) as { requestId: string; event: LogEvent };
        const stub = getLoggerStub(env, body.requestId);
        const result = await stub.appendEvent(body.event);
        return Response.json(result);
      }

      // POST /artifact - Upsert an artifact (requires requestId in body)
      if (method === 'POST' && path === '/artifact') {
        const body = (await request.json()) as { requestId: string; artifact: ArtifactRecord };
        const stub = getLoggerStub(env, body.requestId);
        await stub.upsertArtifact(body.artifact);
        return Response.json({ ok: true });
      }

      // PATCH /request/:id - Update request fields
      if (method === 'PATCH' && path === '/request/:id' && requestId) {
        const patch = (await request.json()) as RequestFieldsPatch;
        const stub = getLoggerStub(env, requestId);
        await stub.updateRequestFields(patch);
        return Response.json({ ok: true });
      }

      // GET /request/:id - Get full request view
      if (method === 'GET' && path === '/request/:id' && requestId) {
        const cursor = params.get('cursor');
        const limitParam = params.get('limit');
        const stub = getLoggerStub(env, requestId);
        const limitVal = Math.min(Math.max(parseInt(limitParam ?? '', 10) || 100, 1), 1000);
        const view = await stub.getRequestView(
          cursor ? parseInt(cursor, 10) : undefined,
          limitVal
        );
        if (!view) {
          return Response.json({ error: 'Request not found' }, { status: 404 });
        }
        return Response.json(view);
      }

      // GET /request/:id/events - Get paginated events
      if (method === 'GET' && path === '/request/:id/events' && requestId) {
        const cursor = params.get('cursor');
        const limitParam = params.get('limit');
        const stub = getLoggerStub(env, requestId);
        const limitVal = Math.min(Math.max(parseInt(limitParam ?? '', 10) || 100, 1), 1000);
        const result = await stub.getEvents(
          cursor ? parseInt(cursor, 10) : undefined,
          limitVal
        );
        return Response.json(result);
      }

      // GET /stats - Aggregate metrics from D1 index
      if (method === 'GET' && path === '/stats') {
        const [
          stageResult,
          totalResult,
          recentResult,
          domainsResult,
          failuresResult,
          stuckResult
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

      // GET /requests - List requests from D1 index
      if (method === 'GET' && path === '/requests') {
        const domain = params.get('domain');
        const status = params.get('status');
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
            manifestR2Key: row.manifest_r2_key
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
