// Proxy for POST /api/begin -> gateway /begin

interface Env {
  GATEWAY_URL: string;
  PUBLIC_API_KEY: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  if (!env.GATEWAY_URL) {
    return new Response(JSON.stringify({ error: 'GATEWAY_URL not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await request.text();
    const gatewayUrl = `${env.GATEWAY_URL}/begin`;

    const response = await fetch(gatewayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': env.PUBLIC_API_KEY || '',
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      return new Response(JSON.stringify({ error: text || `Gateway returned ${response.status}` }), {
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
