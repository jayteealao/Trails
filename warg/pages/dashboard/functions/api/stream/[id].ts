// Proxy for GET /api/stream/:id -> logger /request/:id/stream (SSE)

interface Env {
  LOGGER: Fetcher;
  INTERNAL_API_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, params, request } = context;

  const requestId = params.id;
  if (!requestId || typeof requestId !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing request ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const headers: Record<string, string> = {
    'X-Internal-API-Key': env.INTERNAL_API_KEY,
  };

  // Forward Last-Event-ID for SSE reconnection
  const lastEventId = request.headers.get('Last-Event-ID');
  if (lastEventId) {
    headers['Last-Event-ID'] = lastEventId;
  }

  try {
    const response = await env.LOGGER.fetch(
      `https://logger/request/${requestId}/stream`,
      { headers },
    );

    if (!response.ok) {
      const text = await response.text();
      return new Response(JSON.stringify({ error: text || `Logger returned ${response.status}` }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Pass through the SSE stream without buffering
    return new Response(response.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
