// Proxy for GET /api/:id -> logger /request/:id (service binding)

interface Env {
  LOGGER: Fetcher;
  INTERNAL_API_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, params } = context;

  const requestId = params.id;
  if (!requestId || typeof requestId !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing request ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const response = await env.LOGGER.fetch(`https://logger/request/${requestId}`, {
      headers: {
        'X-Internal-API-Key': env.INTERNAL_API_KEY,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return new Response(JSON.stringify({ error: text || `Logger returned ${response.status}` }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
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
