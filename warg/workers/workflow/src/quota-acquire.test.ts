import { describe, expect, it, vi } from 'vitest';
import {
  acquireQuotaWithSleep,
  MAX_QUOTA_ATTEMPTS,
  QUOTA_SLEEP_DURATION,
  type QuotaAcquireOutcome,
  type QuotaStep
} from './quota-acquire.js';

function makeMockStep(): QuotaStep & {
  do: ReturnType<typeof vi.fn>;
  sleep: ReturnType<typeof vi.fn>;
} {
  return {
    do: vi.fn(
      async (
        _name: string,
        _config: unknown,
        callback: () => Promise<QuotaAcquireOutcome>
      ) => callback()
    ),
    sleep: vi.fn(async () => {})
  };
}

function denyTimes(denials: number, leaseId = 'lease-1'): () => Promise<QuotaAcquireOutcome> {
  let calls = 0;
  return async () => {
    calls++;
    if (calls <= denials) {
      return { granted: false, retryAfterMs: 3000 };
    }
    return { granted: true, leaseId };
  };
}

describe('acquireQuotaWithSleep', () => {
  it('returns the lease immediately when the first attempt is granted', async () => {
    const step = makeMockStep();

    const result = await acquireQuotaWithSleep(step, 'render', denyTimes(0, 'lease-a'));

    expect(result).toEqual({ leaseId: 'lease-a' });
    expect(step.do).toHaveBeenCalledTimes(1);
    expect(step.sleep).not.toHaveBeenCalled();
  });

  it('sleeps between denied attempts and returns the lease once granted', async () => {
    const step = makeMockStep();

    const result = await acquireQuotaWithSleep(step, 'render', denyTimes(3, 'lease-b'));

    expect(result).toEqual({ leaseId: 'lease-b' });
    expect(step.do).toHaveBeenCalledTimes(4);
    expect(step.sleep).toHaveBeenCalledTimes(3);
  });

  it('throws a plain Error after exhausting the attempt budget', async () => {
    const step = makeMockStep();

    await expect(
      acquireQuotaWithSleep(step, 'monolith', denyTimes(Infinity), 5)
    ).rejects.toThrow('monolith quota not acquired after 5 attempts');

    expect(step.do).toHaveBeenCalledTimes(5);
    // No sleep after the final attempt
    expect(step.sleep).toHaveBeenCalledTimes(4);
  });

  it('uses the injected createExhaustionError factory for the exhaustion throw', async () => {
    const step = makeMockStep();

    class CustomExhaustionError extends Error {
      constructor(msg: string) {
        super(msg);
        this.name = 'CustomExhaustionError';
      }
    }

    const factory = vi.fn((msg: string) => new CustomExhaustionError(msg));

    await expect(
      acquireQuotaWithSleep(step, 'render', denyTimes(Infinity), 3, undefined, factory)
    ).rejects.toBeInstanceOf(CustomExhaustionError);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(
      'render quota not acquired after 3 attempts; resubmit the request to retry'
    );
  });

  it('uses deterministic step and sleep names with the attempt counter', async () => {
    const step = makeMockStep();

    await acquireQuotaWithSleep(step, 'singlefile', denyTimes(2));

    expect(step.do.mock.calls.map((call) => call[0])).toEqual([
      'acquire-singlefile-quota-attempt-1',
      'acquire-singlefile-quota-attempt-2',
      'acquire-singlefile-quota-attempt-3'
    ]);
    expect(step.sleep.mock.calls.map((call) => call[0])).toEqual([
      'wait-for-singlefile-quota-1',
      'wait-for-singlefile-quota-2'
    ]);
    expect(step.sleep.mock.calls.every((call) => call[1] === QUOTA_SLEEP_DURATION)).toBe(true);
  });

  it('configures inner step retries for transient errors only', async () => {
    const step = makeMockStep();

    await acquireQuotaWithSleep(step, 'render', denyTimes(0));

    expect(step.do.mock.calls[0]?.[1]).toEqual({
      retries: { limit: 2, delay: '2 seconds', backoff: 'constant' },
      timeout: '30 seconds'
    });
  });

  it('pins the budget confirmed for the 10-minute cron-sweep window', () => {
    expect(MAX_QUOTA_ATTEMPTS).toBe(20);
    expect(QUOTA_SLEEP_DURATION).toBe('30 seconds');
  });

  it('exhausts the DEFAULT budget (20 attempts), reports "20 attempts", and sleeps exactly 19 times', async () => {
    const step = makeMockStep();

    await expect(
      acquireQuotaWithSleep(step, 'render', denyTimes(Infinity))
    ).rejects.toThrow('render quota not acquired after 20 attempts');

    // All 20 attempt slots consumed
    expect(step.do).toHaveBeenCalledTimes(20);
    // Sleep called between each denied attempt — 19 times (not after the final one)
    expect(step.sleep).toHaveBeenCalledTimes(19);
    // Every sleep uses the canonical duration constant
    expect(step.sleep.mock.calls.every((call) => call[1] === QUOTA_SLEEP_DURATION)).toBe(true);
  });
});
