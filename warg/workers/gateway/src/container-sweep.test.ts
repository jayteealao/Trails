import { describe, expect, it, vi } from 'vitest';
import { sweepOrphanContainers, CONTAINER_SWEEP_MIN_LEASE_AGE_MS } from './index.js';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

const STALE_MS = 6 * 60 * 1000; // older than the 5-minute lease TTL
const FRESH_MS = 60 * 1000;

function createEnv(leasesResponse: Response, stopResponse?: Response) {
  const workflowFetch = vi.fn(async () => leasesResponse);
  const monolithFetch = vi.fn(async () => stopResponse ?? jsonResponse({ ok: true }));
  const env = {
    INTERNAL_API_KEY: 'internal-key',
    WORKFLOW: { fetch: workflowFetch } as unknown as Fetcher,
    MONOLITH: { fetch: monolithFetch } as unknown as Fetcher
  } as Env;
  return { env, workflowFetch, monolithFetch };
}

describe('sweepOrphanContainers', () => {
  it('does nothing when there are no sandbox leases', async () => {
    const { env, monolithFetch } = createEnv(jsonResponse({ leases: [] }));

    const summary = await sweepOrphanContainers(env, 'test');

    expect(summary).toEqual({ source: 'test', leases: 0, stale: 0, stopped: 0, failures: [] });
    expect(monolithFetch).not.toHaveBeenCalled();
  });

  it('skips fresh leases (jobs still inside their lease window)', async () => {
    const { env, monolithFetch } = createEnv(
      jsonResponse({
        leases: [{ leaseId: 'l1', requestId: 'req-fresh', acquiredAt: Date.now() - FRESH_MS }]
      })
    );

    const summary = await sweepOrphanContainers(env, 'test');

    expect(summary.leases).toBe(1);
    expect(summary.stale).toBe(0);
    expect(monolithFetch).not.toHaveBeenCalled();
  });

  it('stops containers for stale leases via the monolith worker', async () => {
    const { env, workflowFetch, monolithFetch } = createEnv(
      jsonResponse({
        leases: [
          { leaseId: 'l1', requestId: 'req-stale', acquiredAt: Date.now() - STALE_MS },
          { leaseId: 'l2', requestId: 'req-fresh', acquiredAt: Date.now() - FRESH_MS }
        ]
      })
    );

    const summary = await sweepOrphanContainers(env, 'test');

    expect(summary).toEqual({ source: 'test', leases: 2, stale: 1, stopped: 1, failures: [] });

    expect(workflowFetch).toHaveBeenCalledWith(
      'https://workflow/browser-quota/sandbox-leases',
      expect.objectContaining({ headers: { 'X-Internal-API-Key': 'internal-key' } })
    );

    expect(monolithFetch).toHaveBeenCalledTimes(1);
    const [stopUrl, stopInit] = monolithFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(stopUrl).toBe('https://monolith/container/stop');
    expect(JSON.parse(String(stopInit.body))).toEqual({ request_id: 'req-stale' });
    expect((stopInit.headers as Record<string, string>)['X-Internal-API-Key']).toBe('internal-key');
  });

  it('records a failure when the stop call is rejected, without throwing', async () => {
    const { env } = createEnv(
      jsonResponse({
        leases: [{ leaseId: 'l1', requestId: 'req-stale', acquiredAt: Date.now() - STALE_MS }]
      }),
      jsonResponse({ error: 'boom' }, 500)
    );

    const summary = await sweepOrphanContainers(env, 'test');

    expect(summary.stale).toBe(1);
    expect(summary.stopped).toBe(0);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0]?.requestId).toBe('req-stale');
    expect(summary.failures[0]?.error).toContain('500');
  });

  it('ignores malformed lease rows', async () => {
    const { env, monolithFetch } = createEnv(
      jsonResponse({
        leases: [
          { leaseId: 'l1', acquiredAt: Date.now() - STALE_MS }, // no requestId
          { leaseId: 'l2', requestId: 'req-no-ts' } // no acquiredAt
        ]
      })
    );

    const summary = await sweepOrphanContainers(env, 'test');

    expect(summary.leases).toBe(2);
    expect(summary.stale).toBe(0);
    expect(monolithFetch).not.toHaveBeenCalled();
  });

  it('throws when the lease listing itself fails', async () => {
    const { env } = createEnv(jsonResponse({ error: 'nope' }, 503));

    await expect(sweepOrphanContainers(env, 'test')).rejects.toThrow(/sandbox-leases fetch failed/);
  });

  it('attempts all stale leases and isolates per-container failures', async () => {
    // Two stale leases; first stop responds 500, second responds ok.
    // Both stops must be attempted and only the first failure is recorded.
    const monolithFetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'internal error' }, 500))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const workflowFetch = vi.fn(async () =>
      jsonResponse({
        leases: [
          { leaseId: 'l1', requestId: 'req-fail', acquiredAt: Date.now() - STALE_MS },
          { leaseId: 'l2', requestId: 'req-ok', acquiredAt: Date.now() - STALE_MS }
        ]
      })
    );
    const env = {
      INTERNAL_API_KEY: 'internal-key',
      WORKFLOW: { fetch: workflowFetch } as unknown as Fetcher,
      MONOLITH: { fetch: monolithFetch } as unknown as Fetcher
    } as Env;

    const summary = await sweepOrphanContainers(env, 'test');

    // Both containers were attempted
    expect(monolithFetch).toHaveBeenCalledTimes(2);
    expect(summary.stale).toBe(2);
    expect(summary.stopped).toBe(1);
    expect(summary.failures).toHaveLength(1);
    // The first lease (req-fail) is the only failure
    expect(summary.failures[0]?.requestId).toBe('req-fail');
    expect(summary.failures[0]?.error).toContain('500');
  });
});

describe('CONTAINER_SWEEP_MIN_LEASE_AGE_MS', () => {
  it('equals 5 * 60 * 1000 — must stay in sync with LEASE_TTL_MS in warg/workers/workflow/src/BrowserQuotaDO.ts', () => {
    // Tripwire: if this constant drifts from BrowserQuotaDO.LEASE_TTL_MS the
    // sweep will either kill valid leases (too low) or miss orphans (too high).
    expect(CONTAINER_SWEEP_MIN_LEASE_AGE_MS).toBe(5 * 60 * 1000);
  });
});
