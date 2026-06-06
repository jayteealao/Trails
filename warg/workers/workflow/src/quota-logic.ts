/**
 * Pure quota-decision logic for {@link BrowserQuotaDO}.
 *
 * Kept free of any `cloudflare:workers` runtime imports so the math (token-bucket
 * refill, burst cap, pool isolation) can be unit-tested under plain Node/Vitest.
 * The Durable Object owns persistence + lease bookkeeping and delegates the
 * "may I grant this?" decision here.
 */

export type LeaseKind = 'bindings_launch' | 'rest_request' | 'sandbox_exec';

/**
 * Launch-rate token bucket. `lastRefillMs` is `undefined` until the first
 * refill, at which point the bucket starts full (`burst` tokens).
 */
export interface TokenBucket {
  tokens: number;
  lastRefillMs: number | undefined;
}

/**
 * Current occupancy snapshot, derived from the live lease map.
 */
export interface QuotaSnapshot {
  /** bindings_launch + rest_request leases currently held (browser pool). */
  browserActive: number;
  /** sandbox_exec leases currently held (Sandbox pool). */
  sandboxActive: number;
  bucket: TokenBucket;
}

export interface QuotaLimits {
  /** Max concurrent browser instances (platform: 120/account). */
  maxConcurrent: number;
  /** Max concurrent Cloudflare Sandbox execs (monolith). */
  maxSandboxConcurrent: number;
  /** Sustained new-browser launch rate (platform: 1/sec fixed fill). */
  launchRatePerSec: number;
  /** Burst tolerance on top of the sustained rate. */
  launchBurst: number;
}

export interface AcquireDecision {
  granted: boolean;
  retryAfterMs?: number;
  /** Bucket state to persist (refilled and/or a token consumed). */
  bucket: TokenBucket;
  /** Whether `bucket` changed and must be persisted on a denied acquire. */
  bucketChanged: boolean;
}

/**
 * Pick the lowest non-negative slot index not present in `usedSlots`.
 * Used to assign a stable warm-pool container to a `sandbox_exec` lease.
 */
export function lowestFreeSlot(usedSlots: Iterable<number>): number {
  const used = new Set(usedSlots);
  let slot = 0;
  while (used.has(slot)) slot += 1;
  return slot;
}

/**
 * Refill the bucket based on elapsed wall-clock time, capped at `burst`.
 * Returns a new bucket; never mutates the input.
 */
export function refillBucket(
  bucket: TokenBucket,
  now: number,
  ratePerSec: number,
  burst: number
): TokenBucket {
  if (bucket.lastRefillMs === undefined) {
    // First touch: start full.
    return { tokens: burst, lastRefillMs: now };
  }
  const elapsedSec = (now - bucket.lastRefillMs) / 1000;
  if (elapsedSec <= 0) {
    // Clock didn't advance (or skewed backwards) — leave tokens untouched.
    return bucket;
  }
  const tokens = Math.min(burst, bucket.tokens + elapsedSec * ratePerSec);
  return { tokens, lastRefillMs: now };
}

/**
 * Decide whether an acquire of `kind` may be granted given current occupancy.
 *
 * - `sandbox_exec`: gated only by a separate concurrency cap (Sandbox has no
 *   documented per-second launch limit).
 * - `bindings_launch`: gated by the browser concurrency cap *and* the launch
 *   token bucket (models the platform's 1 new-browser/sec fixed fill).
 * - `rest_request`: never gated itself — it counts toward the browser pool but
 *   does not launch a new browser. Preserves prior DO behavior.
 */
export function evaluateAcquire(
  kind: LeaseKind,
  snapshot: QuotaSnapshot,
  limits: QuotaLimits,
  now: number
): AcquireDecision {
  if (kind === 'sandbox_exec') {
    if (snapshot.sandboxActive >= limits.maxSandboxConcurrent) {
      return { granted: false, retryAfterMs: 3000, bucket: snapshot.bucket, bucketChanged: false };
    }
    return { granted: true, bucket: snapshot.bucket, bucketChanged: false };
  }

  if (kind === 'rest_request') {
    return { granted: true, bucket: snapshot.bucket, bucketChanged: false };
  }

  // bindings_launch — concurrency first, then launch-rate token.
  if (snapshot.browserActive >= limits.maxConcurrent) {
    return { granted: false, retryAfterMs: 1000, bucket: snapshot.bucket, bucketChanged: false };
  }

  const refilled = refillBucket(snapshot.bucket, now, limits.launchRatePerSec, limits.launchBurst);
  const bucketChanged = refilled !== snapshot.bucket;

  if (refilled.tokens < 1) {
    const deficitMs = Math.ceil(((1 - refilled.tokens) / limits.launchRatePerSec) * 1000);
    return {
      granted: false,
      retryAfterMs: Math.max(deficitMs, 100),
      bucket: refilled,
      bucketChanged
    };
  }

  return {
    granted: true,
    bucket: { tokens: refilled.tokens - 1, lastRefillMs: refilled.lastRefillMs },
    bucketChanged: true
  };
}
