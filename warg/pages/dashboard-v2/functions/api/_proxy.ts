interface Env {
  DASHBOARD_API_URL: string;
  INTERNAL_API_KEY: string;
}

export async function proxyToApi(
  env: Env,
  path: string,
  search?: string
): Promise<Response> {
  const dashboardApiUrl = env.DASHBOARD_API_URL;
  if (!dashboardApiUrl) {
    return Response.json({ error: 'DASHBOARD_API_URL not configured' }, { status: 500 });
  }

  const base = dashboardApiUrl.endsWith('/') ? dashboardApiUrl : dashboardApiUrl + '/';
  const target = new URL(path, base);
  if (search) target.search = search;

  const response = await fetch(target.toString(), {
    headers: { 'X-Internal-API-Key': env.INTERNAL_API_KEY },
    signal: AbortSignal.timeout(30000),
  });

  return new Response(response.body, {
    status: response.status,
    headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/json' },
  });
}

export type { Env };
