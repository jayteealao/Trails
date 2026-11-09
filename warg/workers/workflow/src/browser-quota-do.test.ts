import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserQuotaDO } from './BrowserQuotaDO.js';

const T0 = 1_700_000_000_000;

type MonolithFetch = (input: string, init?: RequestInit) => Promise<Response>;

interface MakeDoOptions {
  /** What the fake monolith answers; defaults to a 200 ok for every stop. */
  monolithFetch?: MonolithFetch;
  /** State already in storage when the object starts, as an earlier run left it. */
  stored?: unknown;
}

/**
 * A quota object over an in-memory storage fake, with the alarm recorded and
 * a fake monolith binding that records each container stop.
 */
function makeDo(options: MakeDoOptions = {}) {
  let stored: unknown = options.stored;
  const setAlarm = vi.fn();
  const storage = {
    get: async () => stored,
    put: async (_key: string, value: unknown) => {
      stored = value;
    },
    setAlarm
  };
  const monolithFetch = vi.fn<MonolithFetch>(
    options.monolithFetch ?? (async () => Response.json({ ok: true }))
  );
  // The class only touches ctx.storage; the fake stands in for the runtime state.
  const ctx = { storage } as unknown as DurableObjectState;
  // The class reads only these two bindings of its env.
  const env = { INTERNAL_API_KEY: 'internal-key', MONOLITH: { fetch: monolithFetch } } as unknown as Env;
  const quota = new BrowserQuotaDO(ctx, env);
  return { quota, setAlarm, monolithFetch, storage };
}

async function sandboxRequestIds(quota: BrowserQuotaDO): Promise<string[]> {
  return (await quota.listSandboxLeases()).map((lease) => lease.requestId);
}

describe('BrowserQuotaDO lease expiry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('arms the clean-up alarm one TTL after an acquire', async () => {
    const { quota, setAlarm } = makeDo();

    const result = await quota.acquire('sandbox_exec', 'req-a');

    expect(result.granted).toBe(true);
    expect(setAlarm).toHaveBeenCalledWith(T0 + 300_000);
  });

  it('keeps a lease one second short of the TTL and re-arms the alarm', async () => {
    const { quota, setAlarm } = makeDo();
    await quota.acquire('sandbox_exec', 'req-a');
    setAlarm.mockClear();

    vi.setSystemTime(T0 + 299_000);
    await quota.alarm();

    expect(await sandboxRequestIds(quota)).toEqual(['req-a']);
    expect(setAlarm).toHaveBeenCalledWith(T0 + 299_000 + 300_000);
  });

  it('drops a lease one second past the TTL and does not re-arm', async () => {
    const { quota, setAlarm } = makeDo();
    await quota.acquire('sandbox_exec', 'req-a');
    setAlarm.mockClear();

    vi.setSystemTime(T0 + 301_000);
    await quota.alarm();

    expect(await sandboxRequestIds(quota)).toEqual([]);
    expect(setAlarm).not.toHaveBeenCalled();
  });

  it('drops a lease whose age is exactly the TTL', async () => {
    const { quota, setAlarm } = makeDo();
    await quota.acquire('sandbox_exec', 'req-a');
    setAlarm.mockClear();

    vi.setSystemTime(T0 + 300_000);
    await quota.alarm();

    expect(await sandboxRequestIds(quota)).toEqual([]);
    expect(setAlarm).not.toHaveBeenCalled();
  });

  it('drops a stale lease on acquire before it counts the pool', async () => {
    const { quota } = makeDo();
    await quota.acquire('sandbox_exec', 'req-a');

    vi.setSystemTime(T0 + 301_000);
    const result = await quota.acquire('sandbox_exec', 'req-b');

    expect(result.granted).toBe(true);
    expect(await sandboxRequestIds(quota)).toEqual(['req-b']);
  });
});

describe('BrowserQuotaDO at the shared lease ages', () => {
  // The same ages and verdicts as the container sweep's table test.
  const AGES = [
    { requestId: 'req-299', ageMs: 299_000, stale: false },
    { requestId: 'req-300', ageMs: 300_000, stale: true },
    { requestId: 'req-301', ageMs: 301_000, stale: true }
  ];
  const NOW = T0 + 301_000;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps on its alarm exactly the leases the container sweep treats as live', async () => {
    const { quota } = makeDo();
    for (const row of AGES) {
      vi.setSystemTime(NOW - row.ageMs);
      await quota.acquire('sandbox_exec', row.requestId);
    }

    vi.setSystemTime(NOW);
    await quota.alarm();

    expect(await sandboxRequestIds(quota)).toEqual(
      AGES.filter((row) => !row.stale).map((row) => row.requestId)
    );
  });
});

describe('BrowserQuotaDO container sweep', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function stoppedRequestIds(monolithFetch: ReturnType<typeof makeDo>['monolithFetch']): string[] {
    return monolithFetch.mock.calls.map(
      ([, init]) => (JSON.parse(String(init?.body)) as { request_id: string }).request_id
    );
  }

  it('stops only the container of the stale lease and keeps the live one', async () => {
    const { quota, monolithFetch } = makeDo();
    await quota.acquire('sandbox_exec', 'req-old');
    vi.setSystemTime(T0 + 200_000);
    await quota.acquire('sandbox_exec', 'req-live');

    vi.setSystemTime(T0 + 301_000);
    await quota.alarm();

    expect(monolithFetch).toHaveBeenCalledTimes(1);
    const [url, init] = monolithFetch.mock.calls[0]!;
    expect(url).toBe('https://monolith/container/stop');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ request_id: 'req-old' });
    expect(new Headers(init?.headers).get('X-Internal-API-Key')).toBe('internal-key');
    expect(await sandboxRequestIds(quota)).toEqual(['req-live']);
  });

  it('drops a stale browser lease without asking monolith to stop anything', async () => {
    const { quota, monolithFetch } = makeDo();
    await quota.acquire('bindings_launch', 'req-browser');

    vi.setSystemTime(T0 + 301_000);
    await quota.alarm();

    expect(monolithFetch).not.toHaveBeenCalled();
  });

  it('logs each stale lease it drops with its request and kind', async () => {
    const { quota } = makeDo();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await quota.acquire('sandbox_exec', 'req-leaked');

    vi.setSystemTime(T0 + 301_000);
    await quota.alarm();

    const logged = warnSpy.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    expect(logged).toContain('stale lease dropped');
    expect(logged).toContain('"requestId":"req-leaked"');
    expect(logged).toContain('"kind":"sandbox_exec"');
  });

  it('reports a failed stop and still stops the other containers', async () => {
    let call = 0;
    const { quota, monolithFetch } = makeDo({
      monolithFetch: async () =>
        call++ === 0 ? new Response('boom', { status: 500 }) : Response.json({ ok: true })
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await quota.acquire('sandbox_exec', 'req-fail');
    await quota.acquire('sandbox_exec', 'req-ok');

    vi.setSystemTime(T0 + 301_000);
    await expect(quota.alarm()).resolves.toBeUndefined();

    expect(stoppedRequestIds(monolithFetch)).toEqual(['req-fail', 'req-ok']);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = errorSpy.mock.calls[0]!.map(String).join(' ');
    expect(logged).toContain('req-fail');
    expect(logged).toContain('"stopped":1');
    expect(await sandboxRequestIds(quota)).toEqual([]);
  });

  it('queues the stop of a lease that acquire drops and runs it on an immediate alarm', async () => {
    const { quota, setAlarm, monolithFetch } = makeDo();
    await quota.acquire('sandbox_exec', 'req-a');

    vi.setSystemTime(T0 + 301_000);
    await quota.acquire('sandbox_exec', 'req-b');

    expect(monolithFetch).not.toHaveBeenCalled();
    expect(setAlarm).toHaveBeenLastCalledWith(T0 + 301_000);

    await quota.alarm();

    expect(stoppedRequestIds(monolithFetch)).toEqual(['req-a']);
  });

  it('skips the stale stop when a retry of the same request holds a newer sandbox lease', async () => {
    const { quota, monolithFetch } = makeDo();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await quota.acquire('sandbox_exec', 'req-retry');

    vi.setSystemTime(T0 + 301_000);
    await quota.acquire('sandbox_exec', 'req-retry');
    await quota.alarm();

    expect(monolithFetch).not.toHaveBeenCalled();
    expect(await sandboxRequestIds(quota)).toEqual(['req-retry']);
    const logged = warnSpy.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    expect(logged).toContain('skipped');
    expect(logged).toContain('req-retry');

    await quota.alarm();
    expect(monolithFetch).not.toHaveBeenCalled();
  });

  it('stops a queued container left by an interrupted alarm once, and only once', async () => {
    const { quota, monolithFetch } = makeDo({
      stored: {
        leases: [],
        launchTokens: 3,
        lastRefillMs: undefined,
        pendingStops: [{ leaseId: 'l1', requestId: 'req-x', acquiredAt: T0 - 400_000 }]
      }
    });

    await quota.alarm();
    expect(stoppedRequestIds(monolithFetch)).toEqual(['req-x']);

    await quota.alarm();
    expect(monolithFetch).toHaveBeenCalledTimes(1);
  });

  it('stops exactly the containers at the shared stale ages', async () => {
    const ages = [
      { requestId: 'req-299', ageMs: 299_000 },
      { requestId: 'req-300', ageMs: 300_000 },
      { requestId: 'req-301', ageMs: 301_000 }
    ];
    const now = T0 + 301_000;
    const { quota, monolithFetch } = makeDo();
    for (const row of ages) {
      vi.setSystemTime(now - row.ageMs);
      await quota.acquire('sandbox_exec', row.requestId);
    }

    vi.setSystemTime(now);
    await quota.alarm();

    expect(stoppedRequestIds(monolithFetch).sort()).toEqual(['req-300', 'req-301']);
  });
});
