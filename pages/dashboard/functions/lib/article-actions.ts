export interface ActionEnv {
  DASHBOARD_API_URL: string;
  INTERNAL_API_KEY: string;
  GATEWAY: Fetcher;
  PUBLIC_API_KEY: string;
}

export class ActionError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'ActionError';
    this.status = status;
  }
}

interface ArticleArchiveStatus {
  key: string;
  status: 'success' | 'pending' | 'failed' | 'absent' | string;
}

interface ArticleDetail {
  item_id: string;
  url: string;
  archives: ArticleArchiveStatus[];
  warg_request_id?: string;
}

export interface EnqueueArticleResult {
  itemId: string;
  queued: boolean;
  existed?: boolean;
}

export interface BootstrapArticleResult {
  itemId: string;
  canonicalItemId: string;
  created: boolean;
  patched: boolean;
  linkedExisting?: boolean;
  shouldStart?: boolean;
  existingRequestId?: string;
}

export interface MarkProcessingResult {
  itemId: string;
  canonicalItemId: string;
  requestId: string;
  updated: boolean;
}

type WorkflowStep = 'render' | 'singlefile' | 'readability' | 'monolith';

const ARCHIVE_TO_STEP: Partial<Record<string, WorkflowStep>> = {
  rendered: 'render',
  singlefile: 'singlefile',
  readability: 'readability',
  markdown: 'readability',
  monolith: 'monolith',
};

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ActionError) {
    return jsonResponse({ error: err.message }, err.status);
  }
  const message = err instanceof Error ? err.message : 'Unknown error';
  return jsonResponse({ error: message }, 500);
}

function buildApiUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(path, base).toString();
}

function assertDashboardApiConfigured(env: ActionEnv): void {
  if (!env.DASHBOARD_API_URL) {
    throw new ActionError('Dashboard API URL is not configured', 500);
  }
  if (!env.INTERNAL_API_KEY) {
    throw new ActionError('Dashboard INTERNAL_API_KEY is not configured', 500);
  }
}

function extractErrorMessage(text: string, fallback: string): string {
  const trimmed = text.trim();
  if (!trimmed) return fallback;

  let value = trimmed;
  for (let i = 0; i < 2; i += 1) {
    try {
      const parsed = JSON.parse(value) as { error?: unknown; message?: unknown } | string;
      if (typeof parsed === 'string') {
        value = parsed;
        continue;
      }
      if (typeof parsed.error === 'string') {
        value = parsed.error;
        continue;
      }
      if (typeof parsed.message === 'string') {
        value = parsed.message;
        continue;
      }
    } catch {
      break;
    }
    break;
  }

  return value;
}

async function requestDashboardApi<T>(
  env: ActionEnv,
  path: string,
  init?: RequestInit,
  options?: { notFoundMessage?: string }
): Promise<T> {
  assertDashboardApiConfigured(env);

  const headers = new Headers(init?.headers);
  headers.set('X-Internal-API-Key', env.INTERNAL_API_KEY);

  const response = await fetch(buildApiUrl(env.DASHBOARD_API_URL, path), {
    ...init,
    headers,
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const text = extractErrorMessage(
      await response.text(),
      `Dashboard API returned ${response.status}`
    );
    if (response.status === 401 || response.status === 403) {
      throw new ActionError(
        'Dashboard API authentication failed. Check INTERNAL_API_KEY.',
        502
      );
    }
    if (response.status === 404) {
      throw new ActionError(options?.notFoundMessage ?? 'Article not found', 404);
    }
    throw new ActionError(text, response.status);
  }

  return (await response.json()) as T;
}

export async function fetchArticleDetail(
  env: ActionEnv,
  itemId: string
): Promise<ArticleDetail> {
  return requestDashboardApi<ArticleDetail>(
    env,
    `articles/${encodeURIComponent(itemId)}`,
    undefined,
    { notFoundMessage: 'Article not found' }
  );
}

export function deriveMissingSteps(archives: ArticleArchiveStatus[]): WorkflowStep[] {
  const steps = new Set<WorkflowStep>();
  for (const archive of archives) {
    if (archive.status !== 'failed' && archive.status !== 'absent') {
      continue;
    }
    const step = ARCHIVE_TO_STEP[archive.key];
    if (step) steps.add(step);
  }
  return Array.from(steps);
}

export async function submitBegin(
  env: ActionEnv,
  payload: Record<string, unknown>
): Promise<{ requestId?: string; request_id?: string }> {
  if (!env.PUBLIC_API_KEY) {
    throw new ActionError(
      'Dashboard PUBLIC_API_KEY is not configured for gateway calls.',
      500
    );
  }

  const response = await env.GATEWAY.fetch('https://gateway/begin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': env.PUBLIC_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = extractErrorMessage(
      await response.text(),
      `Gateway returned ${response.status}`
    );
    if (response.status === 401 || response.status === 403) {
      throw new ActionError(
        'Gateway authentication failed. Check PUBLIC_API_KEY and gateway Access policy.',
        502
      );
    }
    throw new ActionError(text, response.status);
  }

  return (await response.json()) as { requestId?: string; request_id?: string };
}

export async function enqueueArticle(
  env: ActionEnv,
  payload: { url: string; itemId?: string }
): Promise<EnqueueArticleResult> {
  return requestDashboardApi<EnqueueArticleResult>(
    env,
    'articles/enqueue',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    { notFoundMessage: 'User not found' }
  );
}

export async function bootstrapArticle(
  env: ActionEnv,
  itemId: string
): Promise<BootstrapArticleResult> {
  return requestDashboardApi<BootstrapArticleResult>(
    env,
    `articles/${encodeURIComponent(itemId)}/bootstrap`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
    { notFoundMessage: 'User article not found' }
  );
}

export async function markArticleProcessing(
  env: ActionEnv,
  itemId: string,
  requestId: string
): Promise<MarkProcessingResult> {
  return requestDashboardApi<MarkProcessingResult>(
    env,
    `articles/${encodeURIComponent(itemId)}/mark-processing`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId }),
    },
    { notFoundMessage: 'User article not found' }
  );
}

export async function readStepFromRequest(request: Request): Promise<WorkflowStep | undefined> {
  const url = new URL(request.url);
  const queryStep = url.searchParams.get('step');
  if (queryStep) return queryStep as WorkflowStep;

  if (request.headers.get('Content-Type')?.includes('application/json')) {
    try {
      const body = (await request.json()) as { step?: unknown };
      const step = body?.step;
      if (typeof step === 'string' && step.length > 0) {
        return step as WorkflowStep;
      }
    } catch {
      return undefined;
    }
  }

  return undefined;
}
