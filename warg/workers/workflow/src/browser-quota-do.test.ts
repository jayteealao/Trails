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
