import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';

/** A service binding fake that records every URL it is asked for. */
function recordingBinding(answer: (url: string) => Response) {
  const urls: string[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    urls.push(url);
    return answer(url);
  });
  return { binding: { fetch }, urls };
}

async function runCronTick() {
  const logger = recordingBinding(() => Response.json({ requests: [] }));
  const workflow = recordingBinding(() => Response.json({ leases: [] }));
  // Present only to catch a container stop the cron must no longer make.
  const monolith = recordingBinding(() => Response.json({ ok: true }));
  // The cron reads only these bindings; the fakes stand in for the runtime env.
  const env = {
    INTERNAL_API_KEY: 'internal-key',
    PUBLIC_API_KEY: 'public-key',
    LOGGER: logger.binding,
    WORKFLOW: workflow.binding,
    MONOLITH: monolith.binding,
    ARCHIVE_BUCKET: {}
  } as unknown as Env;
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as unknown as ExecutionContext;

  await worker.scheduled({ cron: '*/10 * * * *' } as ScheduledController, env, ctx);
  await Promise.all(pending);

  return { logger: logger.urls, workflow: workflow.urls, monolith: monolith.urls };
}

describe('gateway scheduled()', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never lists sandbox leases and never stops a container', async () => {
    const calls = await runCronTick();

    const everyUrl = [...calls.logger, ...calls.workflow, ...calls.monolith];
    expect(calls.workflow.filter((url) => url.includes('sandbox-leases'))).toEqual([]);
    expect(everyUrl.filter((url) => url.includes('/container/stop'))).toEqual([]);
  });

  it('still runs the queued-orphan sweep', async () => {
    const calls = await runCronTick();

    expect(calls.logger.some((url) => url.includes('/requests?status=queued'))).toBe(true);
  });
});
