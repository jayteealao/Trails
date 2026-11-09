// A stand-in for the logger service, used only by the browser checks. The
// dashboard's overview, request detail and live stream read the logger
// through its service binding; this Worker answers those paths with fixed
// data so a browser run can open each view end to end.

const CREATED_AT = '2026-01-01T00:00:00.000Z';

const STATS = {
  total: 42,
  byStage: { done: 40, rendering: 2 },
  successRate: 0.95,
  failureRate: 0.05,
  activeCount: 2,
  stuckCount: 0,
  recentActivity: { last1h: 3, last24h: 12 },
  topDomains: [{ domain: 'example.test', count: 42 }],
  recentFailures: [],
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (request.method === 'GET' && pathname === '/stats') {
      return json(STATS);
    }

    const stream = pathname.match(/^\/request\/([^/]+)\/stream$/);
    if (request.method === 'GET' && stream) {
      const requestId = decodeURIComponent(stream[1]);
      const body =
        sse('init', { requestId, url: 'https://example.test/stream', createdAt: CREATED_AT, derived: { stage: 'rendering' } }) +
        sse('log', {
          ts: CREATED_AT,
          source: 'renderer',
          type: 'step.started',
          message: 'Stream event from the stub logger',
          data: { step: 'render' },
        }) +
        sse('done', {});
      return new Response(body, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      });
    }

    const detail = pathname.match(/^\/request\/([^/]+)$/);
    if (request.method === 'GET' && detail) {
      // A stage that is not finished, so the detail view opens the live stream.
      return json({
        requestId: decodeURIComponent(detail[1]),
        url: 'https://example.test/stream',
        createdAt: CREATED_AT,
        derived: { stage: 'rendering' },
        events: [],
        artifacts: [],
      });
    }

    return json({});
  },
};
