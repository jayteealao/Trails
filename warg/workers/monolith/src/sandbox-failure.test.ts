import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSandbox } from '@cloudflare/sandbox';
import { runMonolithInSandbox } from './index.js';

vi.mock('@cloudflare/sandbox', () => ({
  getSandbox: vi.fn(),
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
    R2_BUCKET_NAME: 'warg-archives',
    R2_ACCOUNT_ID: 'acct',
    R2_ACCESS_KEY_ID: 'key-id',
    R2_SECRET_ACCESS_KEY: 'key-secret',
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
