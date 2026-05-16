interface Env {
  LOGGER: Fetcher;
  DASHBOARD_API_URL: string;
  INTERNAL_API_KEY: string;
}

interface LoggerRequestsResponse {
  requests?: unknown[];
}

interface DashboardArticlesResponse {
  articles?: unknown[];
}

function buildApiUrl(baseUrl: string, path: string, search?: URLSearchParams): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const url = new URL(path, base);
  if (search) {
    for (const [key, value] of search.entries()) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

async function fetchDashboardArticles(
  env: Env,
  filter: string,
  limit = 50
): Promise<unknown[]> {
  const params = new URLSearchParams();
  params.set('filter', filter);
  params.set('limit', String(limit));
  params.set('page', '1');

  const response = await fetch(buildApiUrl(env.DASHBOARD_API_URL, 'articles', params), {
    headers: { 'X-Internal-API-Key': env.INTERNAL_API_KEY },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Dashboard API returned ${response.status}`);
  }

  const body = (await response.json()) as DashboardArticlesResponse;
  return body.articles ?? [];
}

async function fetchFailedRequests(env: Env): Promise<unknown[]> {
  const response = await env.LOGGER.fetch('https://logger/requests?status=failed&limit=25&offset=0', {
    headers: { 'X-Internal-API-Key': env.INTERNAL_API_KEY },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Logger returned ${response.status}`);
  }

  const body = (await response.json()) as LoggerRequestsResponse;
  return body.requests ?? [];
}

function completedTodayCount(articles: unknown[]): number {
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  return articles.filter((article) => {
    const createdAt = (article as { created_at?: string }).created_at;
    if (!createdAt) return false;
    const ts = Date.parse(createdAt);
    return !Number.isNaN(ts) && now - ts <= oneDayMs;
  }).length;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  try {
    const [
      failedRequests,
      failedArticles,
      incompleteArticles,
      processingArticles,
      recentlyCompleted,
    ] = await Promise.all([
      fetchFailedRequests(context.env),
      fetchDashboardArticles(context.env, 'failed', 50),
      fetchDashboardArticles(context.env, 'incomplete', 50),
      fetchDashboardArticles(context.env, 'processing', 50),
      fetchDashboardArticles(context.env, 'complete', 25),
    ]);

    const payload = {
      needsAttention: {
        failedRequests,
        failedArticles,
        incompleteArticles,
      },
      inProgress: {
        processingArticles,
      },
      recentlyCompleted: {
        articles: recentlyCompleted,
      },
      counts: {
        needsAttention: failedRequests.length + failedArticles.length + incompleteArticles.length,
        inProgress: processingArticles.length,
        completedToday: completedTodayCount(recentlyCompleted),
      },
    };

    return new Response(JSON.stringify(payload), {
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
