import { describe, expect, it, vi } from 'vitest';
import { stopStaleContainers, type StaleSandboxLease } from './container-sweep.js';

type FetchArgs = [input: string, init?: RequestInit];

function fakeMonolith(answer: (call: number) => Promise<Response>) {
  let call = 0;
  const fetch = vi.fn(async (..._args: FetchArgs) => answer(call++));
  // The sweep only calls fetch on the binding.
  return { monolith: { fetch } as unknown as Fetcher, fetch };
}

function lease(requestId: string): StaleSandboxLease {
  return { leaseId: `lease-${requestId}`, requestId, acquiredAt: 0 };
}

describe('stopStaleContainers', () => {
  it('asks monolith to stop each container in order with the internal key', async () => {
    const { monolith, fetch } = fakeMonolith(async () => Response.json({ ok: true }));

    const summary = await stopStaleContainers(
      monolith,
      'internal-key',
      [lease('req-a'), lease('req-b')],
      'test'
    );

    expect(summary).toEqual({ source: 'test', stale: 2, stopped: 2, failures: [] });
    expect(fetch).toHaveBeenCalledTimes(2);
    const calls = fetch.mock.calls;
    expect(calls.map(([url]) => url)).toEqual([
      'https://monolith/container/stop',
      'https://monolith/container/stop'
    ]);
    expect(calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { request_id: 'req-a' },
      { request_id: 'req-b' }
    ]);
    for (const [, init] of calls) {
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('X-Internal-API-Key')).toBe('internal-key');
    }
  });

  it('reports a non-2xx answer as a failure without throwing', async () => {
    const { monolith } = fakeMonolith(async () => new Response('boom', { status: 500 }));

    const summary = await stopStaleContainers(monolith, 'internal-key', [lease('req-a')], 'test');

    expect(summary.stopped).toBe(0);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0]!.requestId).toBe('req-a');
    expect(summary.failures[0]!.error).toContain('500');
  });

  it('reports a rejected fetch as a failure without throwing', async () => {
    const { monolith } = fakeMonolith(async () => {
      throw new Error('network down');
    });

    const summary = await stopStaleContainers(monolith, 'internal-key', [lease('req-a')], 'test');

    expect(summary.failures).toEqual([{ requestId: 'req-a', error: 'network down' }]);
  });

  it('still stops the other containers after one stop fails', async () => {
    const { monolith, fetch } = fakeMonolith(async (call) =>
      call === 0 ? new Response('boom', { status: 500 }) : Response.json({ ok: true })
    );

    const summary = await stopStaleContainers(
      monolith,
      'internal-key',
      [lease('req-fail'), lease('req-ok')],
      'test'
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(summary.stopped).toBe(1);
    expect(summary.failures.map((failure) => failure.requestId)).toEqual(['req-fail']);
  });

  it('makes no call for an empty list', async () => {
    const { monolith, fetch } = fakeMonolith(async () => Response.json({ ok: true }));

    const summary = await stopStaleContainers(monolith, 'internal-key', [], 'test');

    expect(fetch).not.toHaveBeenCalled();
    expect(summary).toEqual({ source: 'test', stale: 0, stopped: 0, failures: [] });
  });
});
