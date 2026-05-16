// Proxy for POST /api/batch -> logger /requests/batch (service binding)

interface Env {
  LOGGER: Fetcher;
  INTERNAL_API_KEY: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  try {
    const body = await request.text();

    const response = await env.LOGGER.fetch('https://logger/requests/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-API-Key': env.INTERNAL_API_KEY,
      },
      body,
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
