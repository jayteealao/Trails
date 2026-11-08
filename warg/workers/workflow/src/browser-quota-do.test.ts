import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserQuotaDO } from './BrowserQuotaDO.js';

const T0 = 1_700_000_000_000;

/** A quota object over an in-memory storage fake, with the alarm recorded. */
function makeDo() {
  let stored: unknown;
  const setAlarm = vi.fn();
  const storage = {
    get: async () => stored,
    put: async (_key: string, value: unknown) => {
      stored = value;
    },
    setAlarm
  };
  // The class only touches ctx.storage; the fake stands in for the runtime state.
  const ctx = { storage } as unknown as DurableObjectState;
  const quota = new BrowserQuotaDO(ctx, {} as Env);
  return { quota, setAlarm };
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

  it('drops a stale lease on acquire before it counts the pool', async () => {
    const { quota } = makeDo();
    await quota.acquire('sandbox_exec', 'req-a');

    vi.setSystemTime(T0 + 301_000);
    const result = await quota.acquire('sandbox_exec', 'req-b');

    expect(result.granted).toBe(true);
    expect(await sandboxRequestIds(quota)).toEqual(['req-b']);
  });
});
