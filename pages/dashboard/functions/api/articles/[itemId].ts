// Proxy for GET /api/articles/:itemId -> dashboard-api cloud function /articles/:itemId

interface Env {
  DASHBOARD_API_URL: string;
  INTERNAL_API_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const itemId = params.itemId as string;

  const baseUrl = env.DASHBOARD_API_URL;
  if (!baseUrl) {
    return new Response(
      JSON.stringify({ error: 'DASHBOARD_API_URL not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  const target = new URL('articles/' + encodeURIComponent(itemId), base);

  try {
    const response = await fetch(target.toString(), {
      headers: {
        'X-Internal-API-Key': env.INTERNAL_API_KEY,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return new Response(
        JSON.stringify({ error: text || `Dashboard API returned ${response.status}` }),
        { status: response.status, headers: { 'Content-Type': 'application/json' } }
      );
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
