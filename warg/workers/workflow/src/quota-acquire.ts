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
 * Throws a plain Error (retried-by-resubmission, not NonRetryableError)
 * once the attempt budget is exhausted.
 */
export async function acquireQuotaWithSleep(
  step: QuotaStep,
  kind: 'monolith' | 'render' | 'singlefile',
  attemptAcquire: () => Promise<QuotaAcquireOutcome>,
  maxAttempts: number = MAX_QUOTA_ATTEMPTS,
  sleepDuration: QuotaSleepDuration = QUOTA_SLEEP_DURATION
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
  throw new Error(
    `${kind} quota not acquired after ${maxAttempts} attempts; resubmit the request to retry`
  );
}
