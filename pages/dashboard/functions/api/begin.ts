// Proxy for POST /api/begin -> gateway /begin (service binding)

interface Env {
  GATEWAY: Fetcher;
  PUBLIC_API_KEY: string;
}

function extractErrorMessage(text: string, fallback: string): string {
  const trimmed = text.trim();
  if (!trimmed) return fallback;
  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === 'string') return parsed.error;
    if (typeof parsed.message === 'string') return parsed.message;
  } catch {
    return trimmed;
  }
  return fallback;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  try {
    if (!env.PUBLIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'Dashboard PUBLIC_API_KEY is not configured for gateway calls.' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const body = await request.text();

    const response = await env.GATEWAY.fetch('https://gateway/begin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': env.PUBLIC_API_KEY,
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      const message =
        response.status === 401 || response.status === 403
          ? 'Gateway authentication failed. Check PUBLIC_API_KEY and gateway Access policy.'
          : extractErrorMessage(text, `Gateway returned ${response.status}`);
      return new Response(JSON.stringify({ error: message }), {
        status: response.status === 401 || response.status === 403 ? 502 : response.status,
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
