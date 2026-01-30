import type {
  InitRequestPayload,
  LogEvent,
  ArtifactRecord,
  RequestFieldsPatch
} from '@warg/shared';
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
  return apiKey === env.INTERNAL_API_KEY;
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
        stub.upsertArtifact(body.artifact);
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
        const limit = params.get('limit');
        const stub = getLoggerStub(env, requestId);
        const view = stub.getRequestView(
          cursor ? parseInt(cursor, 10) : undefined,
          limit ? parseInt(limit, 10) : 100
        );
        if (!view) {
          return Response.json({ error: 'Request not found' }, { status: 404 });
        }
        return Response.json(view);
      }

      // GET /request/:id/events - Get paginated events
      if (method === 'GET' && path === '/request/:id/events' && requestId) {
        const cursor = params.get('cursor');
        const limit = params.get('limit');
        const stub = getLoggerStub(env, requestId);
        const result = stub.getEvents(
          cursor ? parseInt(cursor, 10) : undefined,
          limit ? parseInt(limit, 10) : 100
        );
        return Response.json(result);
      }

      // GET /requests - List requests from D1 index
      if (method === 'GET' && path === '/requests') {
        const domain = params.get('domain');
        const limit = params.get('limit') ?? '50';
        const offset = params.get('offset') ?? '0';

        let query = 'SELECT * FROM requests_index';
        const bindings: (string | number)[] = [];

        if (domain) {
          query += ' WHERE domain = ?';
          bindings.push(domain);
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        bindings.push(parseInt(limit, 10), parseInt(offset, 10));

        const result = await env.INDEX_DB.prepare(query).bind(...bindings).all<RequestsIndexRow>();

        return Response.json({
          requests: result.results.map((row) => ({
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
      console.error('Logger error:', err);
      const message = err instanceof Error ? err.message : 'Internal error';
      return Response.json({ error: message }, { status: 500 });
    }
  }
};
