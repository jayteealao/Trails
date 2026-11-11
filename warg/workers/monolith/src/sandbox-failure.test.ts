import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSandbox } from '@cloudflare/sandbox';
import worker, { runMonolithInSandbox } from './index.js';

// Stands in for the SDK's ContainerUnavailableError, whose constructor takes a full error response.
const { FakeContainerUnavailableError } = vi.hoisted(() => ({
  FakeContainerUnavailableError: class extends Error {
    constructor(
      message: string,
      readonly retryAfterMs: number
    ) {
      super(message);
    }
  }
}));

vi.mock('@cloudflare/sandbox', () => ({
  getSandbox: vi.fn(),
  ContainerUnavailableError: FakeContainerUnavailableError,
  Sandbox: class {},
  ContainerProxy: class {}
}));

const getSandboxMock = vi.mocked(getSandbox);

interface ExecResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

function execOk(stdout = ''): ExecResult {
  return { success: true, exitCode: 0, stdout, stderr: '' };
}

function execFail(stderr: string): ExecResult {
  return { success: false, exitCode: 1, stdout: '', stderr };
}

/** Fake sandbox whose exec() pops results off a queue, in call order. */
function fakeSandbox(execResults: ExecResult[]) {
  const sandbox = {
    exec: vi.fn(async () => {
      const next = execResults.shift();
      if (!next) throw new Error('unexpected exec call');
      return next;
    }),
    stop: vi.fn(async () => {})
  };
  getSandboxMock.mockReturnValue(sandbox as unknown as ReturnType<typeof getSandbox>);
  return sandbox;
}

function createEnv(): Env {
  // Only the fields runMonolithInSandbox reads.
  return {
    INTERNAL_API_KEY: 'test-key',
    Sandbox: {},
    ARCHIVE_BUCKET: {}
  } as unknown as Env;
}

describe('a failed monolith sandbox upload is classified', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it.each([
    [
      'the 32 MiB RPC limit',
      'Serialized RPC arguments are limited to 32MiB, but the value was larger',
      {
        code: 'MONOLITH_RPC_32MIB_LIMIT',
        retryable: false,
        status: 500,
        message: 'Monolith sandbox payload exceeded RPC size limit'
      }
    ],
    [
      'a deadline',
      'deadline exceeded',
      {
        code: 'MONOLITH_TIMEOUT',
        retryable: true,
        status: 500,
        message: 'Sandbox timed out while processing monolith output'
      }
    ],
    [
      'an aborted request (not a timeout word for the sandbox)',
      'request aborted',
      {
        code: 'MONOLITH_SANDBOX_500',
        retryable: true,
        status: 500,
        message: 'Sandbox execution failed: request aborted'
      }
    ],
    [
      'any other error',
      'boom',
      {
        code: 'MONOLITH_SANDBOX_500',
        retryable: true,
        status: 500,
        message: 'Sandbox execution failed: boom'
      }
    ]
  ])('classifies %s', async (_name, stderr, expected) => {
    const sandbox = fakeSandbox([execOk(), execFail(stderr)]);

    await expect(
      runMonolithInSandbox(createEnv(), 'req-x', 'archives/req-x/raw/rendered.html', 'https://example.com')
    ).rejects.toMatchObject(expected);

    expect(sandbox.stop).toHaveBeenCalledTimes(1);
  });
});

describe('a sandbox container that is not ready', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('fails the job retryable at once, without waiting or trying the curl fallback', async () => {
    const notReady = new FakeContainerUnavailableError('container is starting', 3000);
    const sandbox = {
      exec: vi.fn(async () => {
        throw notReady;
      }),
      stop: vi.fn(async () => {})
    };
    getSandboxMock.mockReturnValue(sandbox as unknown as ReturnType<typeof getSandbox>);

    await expect(
      runMonolithInSandbox(createEnv(), 'req-x', 'archives/req-x/raw/rendered.html', 'https://example.com')
    ).rejects.toMatchObject({ code: 'MONOLITH_CONTAINER_UNAVAILABLE', status: 503, retryable: true });

    expect(sandbox.exec).toHaveBeenCalledTimes(1);
    expect(sandbox.stop).toHaveBeenCalledTimes(1);
  });

  it('fails the job retryable when the container is not ready at the upload', async () => {
    const notReady = new FakeContainerUnavailableError('container is starting', 3000);
    const sandbox = {
      exec: vi
        .fn<() => Promise<ExecResult>>()
        .mockResolvedValueOnce(execOk())
        .mockRejectedValueOnce(notReady),
      stop: vi.fn(async () => {})
    };
    getSandboxMock.mockReturnValue(sandbox as unknown as ReturnType<typeof getSandbox>);

    await expect(
      runMonolithInSandbox(createEnv(), 'req-x', 'archives/req-x/raw/rendered.html', 'https://example.com')
    ).rejects.toMatchObject({ code: 'MONOLITH_CONTAINER_UNAVAILABLE', status: 503, retryable: true });

    expect(sandbox.exec).toHaveBeenCalledTimes(2);
    expect(sandbox.stop).toHaveBeenCalledTimes(1);
  });

  it('logs a not-ready container once, as a warning, and answers 503', async () => {
    const notReady = new FakeContainerUnavailableError('container is starting', 3000);
    const sandbox = {
      exec: vi.fn(async () => {
        throw notReady;
      }),
      stop: vi.fn(async () => {})
    };
    getSandboxMock.mockReturnValue(sandbox as unknown as ReturnType<typeof getSandbox>);
    const env = {
      ...createEnv(),
      ARCHIVE_BUCKET: { head: async () => ({ size: 500 }) }
    } as unknown as Env;

    const response = await worker.fetch(
      new Request('https://monolith/monolith', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-API-Key': 'test-key' },
        body: JSON.stringify({
          request_id: 'req-x',
          rendered_html_key: 'archives/req-x/raw/rendered.html',
          base_url: 'https://example.com/'
        })
      }),
      env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'MONOLITH_CONTAINER_UNAVAILABLE', retryable: true });
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.error).not.toHaveBeenCalled();
  });
});
