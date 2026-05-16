// Proxy for GET /api/requests -> logger /requests

interface Env {
  LOGGER_URL: string;
  INTERNAL_API_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const url = new URL(request.url);
  const params = new URLSearchParams();

  // Forward supported query params
  const domain = url.searchParams.get('domain');
  const status = url.searchParams.get('status');
  const limit = url.searchParams.get('limit');
  const offset = url.searchParams.get('offset');

  if (domain) params.set('domain', domain);
  if (status) params.set('status', status);
  if (limit) params.set('limit', limit);
  if (offset) params.set('offset', offset);

  const loggerUrl = `${env.LOGGER_URL}/requests?${params}`;

  try {
    const response = await fetch(loggerUrl, {
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
