import { describe, expect, it } from 'vitest';
import {
  evaluateAcquire,
  refillBucket,
  type QuotaLimits,
  type QuotaSnapshot,
  type TokenBucket
} from './quota-logic.js';

const LIMITS: QuotaLimits = {
  maxConcurrent: 100,
  maxSandboxConcurrent: 4,
  launchRatePerSec: 1,
  launchBurst: 3
};

function snapshot(partial: Partial<QuotaSnapshot> = {}): QuotaSnapshot {
  return {
    browserActive: 0,
    sandboxActive: 0,
    bucket: { tokens: LIMITS.launchBurst, lastRefillMs: 1_000 },
    ...partial
  };
}

describe('refillBucket', () => {
  it('starts full on first touch (lastRefillMs undefined)', () => {
    const result = refillBucket({ tokens: 0, lastRefillMs: undefined }, 5_000, 1, 3);
    expect(result).toEqual({ tokens: 3, lastRefillMs: 5_000 });
  });

  it('accrues one token per second at rate 1', () => {
    const result = refillBucket({ tokens: 0, lastRefillMs: 1_000 }, 2_000, 1, 3);
    expect(result.tokens).toBe(1);
    expect(result.lastRefillMs).toBe(2_000);
  });

  it('accrues fractional tokens for sub-second elapsed', () => {
    const result = refillBucket({ tokens: 0, lastRefillMs: 1_000 }, 1_500, 1, 3);
    expect(result.tokens).toBeCloseTo(0.5, 6);
  });

  it('caps at the burst ceiling', () => {
    const result = refillBucket({ tokens: 0, lastRefillMs: 1_000 }, 100_000, 1, 3);
    expect(result.tokens).toBe(3);
  });

  it('returns the same bucket reference when no time elapsed', () => {
    const bucket: TokenBucket = { tokens: 2, lastRefillMs: 1_000 };
    expect(refillBucket(bucket, 1_000, 1, 3)).toBe(bucket);
  });

  it('does not refill on backward clock skew', () => {
    const bucket: TokenBucket = { tokens: 2, lastRefillMs: 2_000 };
    expect(refillBucket(bucket, 1_000, 1, 3)).toBe(bucket);
  });
});

describe('evaluateAcquire — bindings_launch', () => {
  it('grants and consumes a token when capacity and tokens are available', () => {
    const decision = evaluateAcquire('bindings_launch', snapshot(), LIMITS, 1_000);
    expect(decision.granted).toBe(true);
    expect(decision.bucket.tokens).toBe(LIMITS.launchBurst - 1);
    expect(decision.bucketChanged).toBe(true);
  });

  it('denies at the browser concurrency cap (retry ~1s) without touching tokens', () => {
    const snap = snapshot({ browserActive: LIMITS.maxConcurrent });
    const decision = evaluateAcquire('bindings_launch', snap, LIMITS, 1_000);
    expect(decision.granted).toBe(false);
    expect(decision.retryAfterMs).toBe(1_000);
    expect(decision.bucketChanged).toBe(false);
    expect(decision.bucket.tokens).toBe(LIMITS.launchBurst);
  });

  it('denies when the launch token bucket is empty, with a refill-time retry', () => {
    const snap = snapshot({ bucket: { tokens: 0, lastRefillMs: 1_000 } });
    const decision = evaluateAcquire('bindings_launch', snap, LIMITS, 1_000);
    expect(decision.granted).toBe(false);
    expect(decision.retryAfterMs).toBe(1_000); // need 1 full token at 1/sec
  });

  it('computes a partial-token retry from the deficit', () => {
    const snap = snapshot({ bucket: { tokens: 0.25, lastRefillMs: 1_000 } });
    const decision = evaluateAcquire('bindings_launch', snap, LIMITS, 1_000);
    expect(decision.granted).toBe(false);
    expect(decision.retryAfterMs).toBe(750);
  });

  it('grants once enough time has elapsed to refill a token', () => {
    const snap = snapshot({ bucket: { tokens: 0, lastRefillMs: 1_000 } });
    const decision = evaluateAcquire('bindings_launch', snap, LIMITS, 2_000);
    expect(decision.granted).toBe(true);
    expect(decision.bucket.tokens).toBeCloseTo(0, 6);
  });

  it('is not blocked by a saturated sandbox pool (pool isolation)', () => {
    const snap = snapshot({ sandboxActive: LIMITS.maxSandboxConcurrent });
    const decision = evaluateAcquire('bindings_launch', snap, LIMITS, 1_000);
    expect(decision.granted).toBe(true);
  });
});

describe('evaluateAcquire — sandbox_exec', () => {
  it('grants below the sandbox cap and never consumes a launch token', () => {
    const snap = snapshot({ sandboxActive: 3 });
    const decision = evaluateAcquire('sandbox_exec', snap, LIMITS, 1_000);
    expect(decision.granted).toBe(true);
    expect(decision.bucket.tokens).toBe(LIMITS.launchBurst);
    expect(decision.bucketChanged).toBe(false);
  });

  it('denies at the sandbox cap (retry 3s)', () => {
    const snap = snapshot({ sandboxActive: LIMITS.maxSandboxConcurrent });
    const decision = evaluateAcquire('sandbox_exec', snap, LIMITS, 1_000);
    expect(decision.granted).toBe(false);
    expect(decision.retryAfterMs).toBe(3_000);
  });

  it('is not blocked by a saturated browser pool (pool isolation)', () => {
    const snap = snapshot({ browserActive: LIMITS.maxConcurrent, sandboxActive: 0 });
    const decision = evaluateAcquire('sandbox_exec', snap, LIMITS, 1_000);
    expect(decision.granted).toBe(true);
  });
});

describe('evaluateAcquire — rest_request', () => {
  it('is always granted and never gated by concurrency or tokens', () => {
    const snap = snapshot({ browserActive: LIMITS.maxConcurrent, bucket: { tokens: 0, lastRefillMs: 1_000 } });
    const decision = evaluateAcquire('rest_request', snap, LIMITS, 1_000);
    expect(decision.granted).toBe(true);
    expect(decision.bucketChanged).toBe(false);
    expect(decision.bucket.tokens).toBe(0);
  });
});
