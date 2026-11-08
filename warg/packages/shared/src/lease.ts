/**
 * How long a sandbox lease stays live, in milliseconds.
 *
 * One worker reads this value: the workflow's BrowserQuotaDO drops a lease
 * once it is stale, which frees the quota slot, and for a sandbox lease asks
 * monolith to stop its container, because a job that held its lease this long
 * has crashed or hung (P99 monolith wall time is about 3 minutes). It arms its
 * clean-up alarm one TTL after an acquire.
 *
 * One worker holds every reader, so a value change needs no deploy order.
 */
export const LEASE_TTL_MS = 5 * 60 * 1000;

/** A lease is stale once its age reaches LEASE_TTL_MS. */
export function isLeaseStale(acquiredAt: number, now: number): boolean {
  return now - acquiredAt >= LEASE_TTL_MS;
}
