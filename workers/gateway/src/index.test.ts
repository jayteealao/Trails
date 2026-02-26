import { beforeEach, describe, expect, it, vi } from 'vitest';
import gateway from './index.js';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

interface CapturedLoggerEvent {
  requestId: string;
  event: { type: string };
}

function createEnv() {
  const loggerEvents: CapturedLoggerEvent[] = [];
  const loggerFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === 'https://logger/request/init') {
      return jsonResponse({ created: true }, 201);
    }
    if (url === 'https://logger/event') {
      const body = JSON.parse(String(init?.body)) as CapturedLoggerEvent;
      loggerEvents.push(body);
      return jsonResponse({ eventId: loggerEvents.length }, 200);
    }
    if (url.startsWith('https://logger/requests?status=queued')) {
      return jsonResponse({
        requests: [
          {
            requestId: 'queued-old-1234',
            url: 'https://example.com/old',
            createdAt: '2025-01-01T00:00:00.000Z',
            lastEventTs: null,
            stage: 'queued'
          },
          {
            requestId: 'queued-recent-1234',
            url: 'https://example.com/new',
            createdAt: new Date().toISOString(),
            lastEventTs: null,
            stage: 'queued'
          }
        ]
      });
    }
    return jsonResponse({ error: 'unexpected logger route' }, 404);
  });

  const workflowFetch = vi.fn(async (): Promise<Response> =>
    jsonResponse({ error: 'Internal error', message: '(instance.already_exists) Instance already exists' }, 500)
  );

  return {
    env: {
      PUBLIC_API_KEY: 'public-key',
      INTERNAL_API_KEY: 'internal-key',
      LOGGER: { fetch: loggerFetch } as unknown as Fetcher,
      WORKFLOW: { fetch: workflowFetch } as unknown as Fetcher,
      ARCHIVE_BUCKET: {
        put: vi.fn(async () => {})
      } as unknown as R2Bucket
    } as Env,
    loggerFetch,
    workflowFetch,
    loggerEvents
  };
}

describe('gateway begin hardening', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns non-2xx when workflow trigger fails', async () => {
    const { env, loggerEvents } = createEnv();
    const request = new Request('https://gateway.jayteealao.workers.dev/begin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': env.PUBLIC_API_KEY
      },
      body: JSON.stringify({ url: 'https://example.com' })
    });

    const response = await gateway.fetch(request, env, {} as ExecutionContext);
    const data = (await response.json()) as { errorCode?: string };

    expect(response.status).toBe(502);
    expect(data.errorCode).toBe('WORKFLOW_TRIGGER_FAILED');
    expect(loggerEvents.map((entry) => entry.event.type)).toContain('workflow.trigger_failed');
    expect(loggerEvents.map((entry) => entry.event.type)).toContain('request.failed');
  });

  it('supports dry-run orphan queued sweep via internal endpoint', async () => {
    const { env, workflowFetch } = createEnv();
    const request = new Request('https://gateway.jayteealao.workers.dev/internal/sweep-orphan-queued', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-API-Key': env.INTERNAL_API_KEY
      },
      body: JSON.stringify({ dryRun: true, minAgeMs: 60_000 })
    });

    const response = await gateway.fetch(request, env, {} as ExecutionContext);
    const data = (await response.json()) as {
      dryRun: boolean;
      scanned: number;
      candidates: number;
      retriggered: number;
      skipped: number;
    };

    expect(response.status).toBe(200);
    expect(data.dryRun).toBe(true);
    expect(data.scanned).toBe(2);
    expect(data.candidates).toBe(1);
    expect(data.retriggered).toBe(0);
    expect(data.skipped).toBe(1);
    expect(workflowFetch).not.toHaveBeenCalled();
  });
});
