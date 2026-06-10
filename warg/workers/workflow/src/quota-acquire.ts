/**
 * Bounded quota-acquire loop shared by the three quota-gated pipeline steps.
 *
 * Each attempt is a small step.do whose retries cover transient DO failures
 * only — quota denial is a return value, not an exception. Between denied
 * attempts the workflow suspends via step.sleep, which bills zero CPU and
 * does not consume the step budget, so contended jobs reschedule instead of
 * spinning or failing (the old config burned 20 × 3s retries inside one step).
 *
 * Kept free of cloudflare imports so the loop is unit-testable in plain Node
 * (same convention as quota-logic.ts).
 *
 * ## Worst-case step budget
 *
 * Per quota type, the loop consumes at most:
 *   - 20 step.do "acquire" attempts × up to 3 executions each (1 + retries.limit 2)
 *     = 60 step.do executions
 *   - 19 step.sleep calls between denied attempts (step.sleep is zero-billed for
 *     CPU and does NOT count against the 1 000-step Workflows limit)
 *
 * Three quota types run per workflow (render, singlefile, monolith), so the
 * theoretical ceiling across the whole run is:
 *   3 × 60 step.do  = 180 extra step slots
 *   3 × 19 step.sleep = 57 sleeps (free)
 *
 * That leaves ~820 of the 1 000-step budget for the rest of the pipeline.
 * In practice contention is rare and most runs use a single acquire attempt.
 *
 * Note: the quota DO's `retryAfterMs` hint is intentionally ignored. The
 * fixed 30 s sleep cadence was a deliberate PO decision (predictable tail
 * latency over optimal throughput). Revisit if per-job concurrency reaches
 * ~10× current volume.
 */

/** Worst-case wait 20 × 30s = 10 minutes, matching the orphan cron-sweep window. */
export const MAX_QUOTA_ATTEMPTS = 20;
export const QUOTA_SLEEP_DURATION = '30 seconds';

/** Literal type keeps QuotaStep.sleep assignable from WorkflowStep.sleep. */
type QuotaSleepDuration = typeof QUOTA_SLEEP_DURATION;

/** Inner retries handle transient DO errors only; denial never throws. */
const ACQUIRE_STEP_CONFIG = {
  retries: { limit: 2, delay: '2 seconds', backoff: 'constant' },
  timeout: '30 seconds'
} as const;

export type QuotaAcquireOutcome =
  | { granted: true; leaseId: string }
  | { granted: false; retryAfterMs?: number };

/**
 * Structural subset of Cloudflare's WorkflowStep used by the loop.
 */
export interface QuotaStep {
  do(
    name: string,
    config: typeof ACQUIRE_STEP_CONFIG,
    callback: () => Promise<QuotaAcquireOutcome>
  ): Promise<QuotaAcquireOutcome>;
  sleep(name: string, duration: QuotaSleepDuration): Promise<void>;
}

/**
 * Acquire a quota lease, sleeping between denied attempts. Step and sleep
 * names embed the attempt counter so they stay deterministic on replay.
 * Throws once the attempt budget is exhausted using the provided factory
 * (defaults to plain Error; pass `(m) => new NonRetryableError(m)` at call
 * sites where cloudflare:workflows is available so the engine never replays
 * the full sleep budget on exhaustion).
 */
export async function acquireQuotaWithSleep(
  step: QuotaStep,
  kind: 'monolith' | 'render' | 'singlefile',
  attemptAcquire: () => Promise<QuotaAcquireOutcome>,
  maxAttempts: number = MAX_QUOTA_ATTEMPTS,
  sleepDuration: QuotaSleepDuration = QUOTA_SLEEP_DURATION,
  createExhaustionError: (message: string) => Error = (m) => new Error(m)
): Promise<{ leaseId: string }> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await step.do(
      `acquire-${kind}-quota-attempt-${attempt}`,
      ACQUIRE_STEP_CONFIG,
      attemptAcquire
    );
    if (result.granted) {
      return { leaseId: result.leaseId };
    }
    if (attempt < maxAttempts) {
      await step.sleep(`wait-for-${kind}-quota-${attempt}`, sleepDuration);
    }
  }
  throw createExhaustionError(
    `${kind} quota not acquired after ${maxAttempts} attempts; resubmit the request to retry`
  );
}
