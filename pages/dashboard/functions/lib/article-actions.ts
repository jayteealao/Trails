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

export async function fetchArticleDetail(
  env: ActionEnv,
  itemId: string
): Promise<ArticleDetail> {
  if (!env.DASHBOARD_API_URL) {
    throw new ActionError('Dashboard API URL is not configured', 500);
  }
  if (!env.INTERNAL_API_KEY) {
    throw new ActionError('Dashboard INTERNAL_API_KEY is not configured', 500);
  }

  const response = await fetch(buildApiUrl(env.DASHBOARD_API_URL, `articles/${encodeURIComponent(itemId)}`), {
    headers: { 'X-Internal-API-Key': env.INTERNAL_API_KEY },
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
      throw new ActionError('Article not found', 404);
    }
    throw new ActionError(text, response.status);
  }

  return (await response.json()) as ArticleDetail;
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
