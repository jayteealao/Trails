import {
  createExecutionContext,
  createScheduledController,
  env,
  waitOnExecutionContext
} from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KindHealthRow, WorkflowStep } from '@warg/shared';
import { HEALTH_KIND_ARTIFACTS } from '@warg/shared';
import worker from './index';

const DAILY_CRON = '0 8 * * *';
const TEN_MINUTE_CRON = '*/10 * * * *';
const NOW_MS = Date.parse('2026-11-07T08:00:00Z');
const HOUR = 3_600_000;
const INTERNAL_API_KEY = 'runtime-test-key-local-only';

let seq = 0;

/** `requested` requests for `kind` created 2 hours before `nowMs`, of which `succeeded` hold their artifact 1 hour before. */
function rowsFor(kind: WorkflowStep, requested: number, succeeded: number, nowMs = NOW_MS): KindHealthRow[] {
  return Array.from({ length: requested }, (_, i) => {
    seq += 1;
    return {
      requestId: `runtime-${seq}`,
      createdAt: new Date(nowMs - 2 * HOUR).toISOString(),
      requestedSteps: [kind],
      artifacts:
        i < succeeded ? [{ kind: HEALTH_KIND_ARTIFACTS[kind], createdAt: new Date(nowMs - HOUR).toISOString() }] : []
    };
  });
}

/** A request for `kind` created and archived `hours` hours before `NOW_MS`. */
function oldSuccess(kind: WorkflowStep, hours: number): KindHealthRow {
  const at = new Date(NOW_MS - hours * HOUR).toISOString();
  return { requestId: `runtime-old-${kind}`, createdAt: at, requestedSteps: [kind], artifacts: [{ kind: HEALTH_KIND_ARTIFACTS[kind], createdAt: at }] };
}

function healthyRows(nowMs = NOW_MS): KindHealthRow[] {
  return (['render', 'singlefile', 'readability', 'monolith'] as const).flatMap((kind) => rowsFor(kind, 5, 5, nowMs));
}

interface Harness {
  testEnv: Env;
  send: ReturnType<typeof vi.fn>;
  loggerPaths: string[];
}

function harness(rows: unknown[], options: { loggerDown?: boolean } = {}): Harness {
  const loggerPaths: string[] = [];
  const send = vi.fn(async () => ({ messageId: 'm-1' }));
  const logger = {
    fetch: async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      loggerPaths.push(url.pathname);
      if (url.pathname === '/health/kinds') {
        if (options.loggerDown) return new Response('logger down', { status: 503 });
        return Response.json({ since: new Date(NOW_MS - 49 * HOUR).toISOString(), buckets: 1, rows });
      }
      if (url.pathname === '/requests') return Response.json({ requests: [] });
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
  };
  const workflow = { fetch: async () => Response.json({ leases: [] }) };
  // Test boundary: the stand-ins implement only the calls the gateway makes.
  const testEnv = { ...env, LOGGER: logger, WORKFLOW: workflow, HEALTH_EMAIL: { send } } as unknown as Env;
  return { testEnv, send, loggerPaths };
}

async function runCron(testEnv: Env, cron: string): Promise<void> {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ cron, scheduledTime: NOW_MS }), testEnv, ctx);
  await waitOnExecutionContext(ctx);
}

interface SentEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
}

function sentEmail(send: Harness['send']): SentEmail {
  expect(send).toHaveBeenCalledTimes(1);
  return send.mock.calls[0]![0] as SentEmail;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('daily archive health check', () => {
  it('sends one email naming a kind below 80% success with its counts', async () => {
    const rows = [...rowsFor('singlefile', 10, 7), ...rowsFor('readability', 10, 10), ...rowsFor('monolith', 3, 1)];
    const { testEnv, send } = harness(rows);

    await runCron(testEnv, DAILY_CRON);

    const email = sentEmail(send);
    expect(email.to).toBe('owner@example.com');
    expect(email.from).toBe('alerts@example.com');
    expect(email.text).toContain('singlefile');
    expect(email.text).toContain('7/10');
    expect(email.text).toContain('70%');
    expect(email.text).not.toContain('readability');
    expect(email.text).not.toContain('monolith');
  });

  it('includes a kind with no success for 48 hours', async () => {
    const { testEnv, send } = harness([...rowsFor('monolith', 2, 0), oldSuccess('monolith', 50)]);

    await runCron(testEnv, DAILY_CRON);

    const email = sentEmail(send);
    expect(email.text).toContain('monolith');
    expect(email.text).toContain('no success for 48 hours');
  });

  it('logs the run and sends nothing when every kind is healthy', async () => {
    const log = vi.spyOn(console, 'log');
    const { testEnv, send } = harness(healthyRows());

    await runCron(testEnv, DAILY_CRON);

    expect(send).not.toHaveBeenCalled();
    const lines = log.mock.calls.filter((call) => call[0] === '[gateway] kind health:');
    expect(lines).toHaveLength(1);
    expect(String(lines[0]![1])).toContain('"emailed":false');
  });

  it('emails the owner and fails the cron run when the check cannot read the logger', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { testEnv, send } = harness([], { loggerDown: true });

    await expect(runCron(testEnv, DAILY_CRON)).rejects.toThrow();

    const email = sentEmail(send);
    expect(email.subject).toBe('Warg archive health: the daily check failed');
    expect(email.text).toContain('no archive kind was measured');
  });

  it('keeps the error of the check when the failure email cannot be sent either', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { testEnv, send } = harness([], { loggerDown: true });
    send.mockRejectedValueOnce(new Error('send refused'));

    await expect(runCron(testEnv, DAILY_CRON)).rejects.toThrow(/logger|503/i);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('measures the other rows when one row is malformed', async () => {
    const log = vi.spyOn(console, 'log');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { testEnv, send } = harness([{ requestId: 'bad', createdAt: 5, artifacts: [] }, ...rowsFor('singlefile', 10, 7)]);

    await runCron(testEnv, DAILY_CRON);

    expect(sentEmail(send).text).toContain('7/10');
    const line = log.mock.calls.find((call) => call[0] === '[gateway] kind health:');
    expect(String(line?.[1])).toContain('"skippedRows":1');
  });

  it('does not run the check on the ten-minute cron', async () => {
    const { testEnv, send, loggerPaths } = harness(rowsFor('singlefile', 10, 7));

    await runCron(testEnv, TEN_MINUTE_CRON);

    expect(send).not.toHaveBeenCalled();
    expect(loggerPaths).not.toContain('/health/kinds');
  });

  describe('POST /internal/health-check', () => {
    function post(testEnv: Env, body: unknown, key?: string): Promise<Response> {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (key) headers['X-Internal-API-Key'] = key;
      const request = new Request('https://gateway/internal/health-check', {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });
      return worker.fetch(request, testEnv, createExecutionContext());
    }

    it('refuses a call without the internal key', async () => {
      const { testEnv, send } = harness(healthyRows(Date.now()));
      expect((await post(testEnv, {})).status).toBe(401);
      expect(send).not.toHaveBeenCalled();
    });

    it('refuses an invalid threshold', async () => {
      const { testEnv, send } = harness(healthyRows(Date.now()));
      const res = await post(testEnv, { thresholds: { minRatio: 2 } }, INTERNAL_API_KEY);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid threshold: minRatio' });
      expect(send).not.toHaveBeenCalled();
    });

    it('sends a test email when the stale period is lowered to zero', async () => {
      const { testEnv, send } = harness(healthyRows(Date.now()));
      const res = await post(testEnv, { thresholds: { staleAfterHours: 0 } }, INTERNAL_API_KEY);
      expect(res.status).toBe(200);
      const summary = (await res.json()) as { emailed: boolean; source: string; alertKinds: string[] };
      expect(summary.emailed).toBe(true);
      expect(summary.source).toBe('manual');
      expect(summary.alertKinds).toEqual(['render', 'singlefile', 'readability', 'monolith']);
      expect(send).toHaveBeenCalledTimes(1);
    });
  });
});
