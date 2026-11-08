/** A sandbox lease the quota object dropped because it outlived the lease TTL. */
export interface StaleSandboxLease {
  leaseId: string;
  requestId: string;
  acquiredAt: number;
}

export interface ContainerSweepResult {
  source: string;
  stale: number;
  stopped: number;
  failures: Array<{ requestId: string; error: string }>;
}

/**
 * Ask monolith to stop the container behind each stale sandbox lease — the
 * third lifecycle layer after monolith's per-job stop() and the Sandbox
 * class's 5-minute sleepAfter backstop. Best-effort: every lease is
 * attempted, and a per-container failure is reported, never thrown.
 */
export async function stopStaleContainers(
  monolith: Fetcher,
  internalApiKey: string,
  leases: StaleSandboxLease[],
  source: string
): Promise<ContainerSweepResult> {
  const summary: ContainerSweepResult = { source, stale: leases.length, stopped: 0, failures: [] };

  for (const lease of leases) {
    try {
      const response = await monolith.fetch('https://monolith/container/stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-API-Key': internalApiKey
        },
        body: JSON.stringify({ request_id: lease.requestId }),
        signal: AbortSignal.timeout(10_000)
      });
      if (response.ok) {
        summary.stopped += 1;
      } else {
        const body = (await response.text()).slice(0, 300);
        summary.failures.push({
          requestId: lease.requestId,
          error: `stop failed (${response.status}): ${body}`
        });
      }
    } catch (err) {
      summary.failures.push({
        requestId: lease.requestId,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  return summary;
}
