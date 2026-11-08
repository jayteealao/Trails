/**
 * How long a sandbox lease stays live, in milliseconds.
 *
 * Two workers read this value:
 * - The workflow's BrowserQuotaDO drops a lease once it is stale, which frees
 *   the quota slot, and arms its clean-up alarm one TTL after an acquire.
 * - The gateway's container sweep stops the container of a lease once it is
 *   stale, because a job that held its lease this long has crashed or hung
 *   (P99 monolith wall time is about 3 minutes).
 *
 * Deploy order. Each worker bundles this value at its own deploy, so between
 * the two deploys they can hold different values:
 * - Value unchanged: the workflow and the gateway deploy in either order.
 * - The sweep's threshold must never be below the quota object's TTL, or the
 *   sweep stops containers whose lease is still live. A higher sweep threshold
 *   only delays clean-up (the container's idle timeout still stops it).
 * - To raise the TTL, deploy the gateway first, then the workflow.
 * - To lower the TTL, deploy the workflow first, then the gateway.
 * Once one worker holds both readers, the order no longer matters.
 */
export const LEASE_TTL_MS = 5 * 60 * 1000;

/** A lease is stale once its age reaches LEASE_TTL_MS. */
export function isLeaseStale(acquiredAt: number, now: number): boolean {
  return now - acquiredAt >= LEASE_TTL_MS;
}
