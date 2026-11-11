import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContainerUnavailableError, getSandbox } from '@cloudflare/sandbox';
import worker from './index.js';

// The handler checks `instanceof ContainerUnavailableError` against its own
// import, so the mock exports the class that these tests then throw.
vi.mock('@cloudflare/sandbox', () => ({
  getSandbox: vi.fn(),
  Sandbox: class {},
  ContainerProxy: class {},
  ContainerUnavailableError: class extends Error {}
}));

const getSandboxMock = vi.mocked(getSandbox);
// The real constructor takes a platform error response; the mock above is a
// plain Error subclass, so the test builds it from a message.
const UnavailableError = ContainerUnavailableError as unknown as new (message: string) => Error;

const env = { INTERNAL_API_KEY: 'test-key', Sandbox: {} } as unknown as Env;
const ctx = {} as ExecutionContext;

function stopRequest(requestId = 'req-a'): Request {
  return new Request('https://monolith/container/stop', {
    method: 'POST',
    headers: { 'X-Internal-API-Key': 'test-key', 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: requestId })
  });
}

function sandboxWithStop(stop: () => Promise<void>) {
  const fake = { stop: vi.fn(stop) };
  getSandboxMock.mockReturnValue(fake as unknown as ReturnType<typeof getSandbox>);
  return fake;
}

describe('monolith POST /container/stop is idempotent', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    getSandboxMock.mockReset();
  });

  it('stops a running container once and answers 200 ok', async () => {
    const sandbox = sandboxWithStop(async () => {});

    const res = await worker.fetch(stopRequest(), env, ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sandbox.stop).toHaveBeenCalledTimes(1);
  });

  it('answers 200 to a second stop of the same container that is already stopped', async () => {
    const sandbox = { stop: vi.fn() };
    sandbox.stop
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new UnavailableError('container unavailable'));
    getSandboxMock.mockReturnValue(sandbox as unknown as ReturnType<typeof getSandbox>);

    const first = await worker.fetch(stopRequest(), env, ctx);
    const second = await worker.fetch(stopRequest(), env, ctx);

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({
      ok: true,
      note: 'container already stopped or never started'
    });
    expect(sandbox.stop).toHaveBeenCalledTimes(2);
  });

  it('answers 200 when the platform says the container is not running', async () => {
    sandboxWithStop(async () => {
      throw new Error('container not running');
    });

    const res = await worker.fetch(stopRequest(), env, ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      note: 'container already stopped or never started'
    });
  });
});
