import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('BrowserQuotaDO limits', () => {
  it('grants 200 browser leases, denies the 201st with a retry delay, and grants again after a release', async () => {
    // A fresh instance per run: the workflow's shared instance is 'global'.
    const quota = env.BROWSER_QUOTA.get(
      env.BROWSER_QUOTA.idFromName('quota-limits-' + crypto.randomUUID())
    );

    // rest_request leases count toward the browser pool without taking a
    // launch token, so the pool fills without depending on the clock.
    const leaseIds: string[] = [];
    for (let i = 0; i < 199; i += 1) {
      const lease = await quota.acquire('rest_request', `rest-${i}`);
      expect(lease.granted).toBe(true);
      if (lease.leaseId) leaseIds.push(lease.leaseId);
    }
    const launch = await quota.acquire('bindings_launch', 'launch-200');
    expect(launch.granted).toBe(true);

    const denied = await quota.acquire('bindings_launch', 'launch-201');
    expect(denied).toEqual({ granted: false, retryAfterMs: 1_000 });

    // The denial was the concurrency cap, not the launch bucket.
    await quota.release(leaseIds[0]);
    const afterRelease = await quota.acquire('bindings_launch', 'launch-after-release');
    expect(afterRelease.granted).toBe(true);
  });
});
