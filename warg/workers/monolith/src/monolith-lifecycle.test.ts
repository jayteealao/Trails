import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSandbox } from '@cloudflare/sandbox';
import { runMonolithInSandbox } from './index.js';

vi.mock('@cloudflare/sandbox', () => ({
  getSandbox: vi.fn(),
  Sandbox: class {}
}));

vi.mock('./r2-presign.js', () => ({
  presignR2GetUrl: vi.fn(async () => 'https://r2.example/presigned-get'),
  presignR2PutUrl: vi.fn(async () => 'https://r2.example/presigned-put')
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

const UPLOAD_OK_STDOUT = `SHA256=${'a'.repeat(64)}\nBYTES=1234\n`;

/**
 * Fake sandbox whose exec() pops results off a queue, in call order:
 * [monolith run, (curl fallback, monolith file run,) upload].
 */
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

describe('runMonolithInSandbox container lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stops the container once on the success path', async () => {
    const sandbox = fakeSandbox([execOk(), execOk(UPLOAD_OK_STDOUT)]);

    const result = await runMonolithInSandbox(
      createEnv(),
      'req-success',
      'archives/req-success/raw/rendered.html',
      'https://example.com'
    );

    expect(result.artifact.kind).toBe('monolith.html');
    expect(result.artifact.bytes).toBe(1234);
    expect(result.artifact.sha256).toBe('a'.repeat(64));
    expect(sandbox.stop).toHaveBeenCalledTimes(1);
  });

  it('keys the sandbox off the request id (no warm pool)', async () => {
    fakeSandbox([execOk(), execOk(UPLOAD_OK_STDOUT)]);

    const result = await runMonolithInSandbox(
      createEnv(),
      'Req-Keyed-123',
      'archives/req/raw/rendered.html',
      'https://example.com'
    );

    expect(result.sandboxId).toBe('req-keyed-123');
    expect(getSandboxMock).toHaveBeenCalledWith(expect.anything(), 'req-keyed-123');
  });

  it('stops the container once when execution fails (primary + curl fallback)', async () => {
    const sandbox = fakeSandbox([
      execFail('monolith blew up'),
      execFail('curl failed too')
    ]);

    await expect(
      runMonolithInSandbox(
        createEnv(),
        'req-exec-fail',
        'archives/req-exec-fail/raw/rendered.html',
        'https://example.com'
      )
    ).rejects.toThrow(/Sandbox execution failed/);

    expect(sandbox.stop).toHaveBeenCalledTimes(1);
  });

  it('stops the container once when the upload fails', async () => {
    const sandbox = fakeSandbox([execOk(), execFail('upload broke')]);

    await expect(
      runMonolithInSandbox(
        createEnv(),
        'req-upload-fail',
        'archives/req-upload-fail/raw/rendered.html',
        'https://example.com'
      )
    ).rejects.toThrow();

    expect(sandbox.stop).toHaveBeenCalledTimes(1);
  });

  it('does not mask the job result when stop() itself fails', async () => {
    const sandbox = fakeSandbox([execOk(), execOk(UPLOAD_OK_STDOUT)]);
    sandbox.stop.mockRejectedValueOnce(new Error('stop exploded'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await runMonolithInSandbox(
      createEnv(),
      'req-stop-fail',
      'archives/req-stop-fail/raw/rendered.html',
      'https://example.com'
    );

    expect(result.artifact.bytes).toBe(1234);
    expect(sandbox.stop).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[monolith\] stop\(\) failed for req-stop-fail \(sandbox: req-stop-fail\) — non-fatal/),
      expect.any(Error)
    );
    warnSpy.mockRestore();
  });

  it('does not mask the original error when both the job and stop() fail', async () => {
    const sandbox = fakeSandbox([execFail('original failure'), execFail('curl failed')]);
    sandbox.stop.mockRejectedValueOnce(new Error('stop exploded'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      runMonolithInSandbox(
        createEnv(),
        'req-double-fail',
        'archives/req-double-fail/raw/rendered.html',
        'https://example.com'
      )
    ).rejects.toThrow(/original failure/);

    expect(sandbox.stop).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('returns success and stops the container once when primary exec fails but curl fallback succeeds', async () => {
    // Queue: [primary fail, curl ok, monolith-file ok, upload ok]
    const sandbox = fakeSandbox([
      execFail('monolith: presigned URL fetch error'),
      execOk(),                       // curl download succeeds
      execOk(),                       // monolith file-path run succeeds
      execOk(UPLOAD_OK_STDOUT)        // upload + hash succeeds
    ]);

    const result = await runMonolithInSandbox(
      createEnv(),
      'req-curl-fallback',
      'archives/req-curl-fallback/raw/rendered.html',
      'https://example.com'
    );

    expect(result.artifact.kind).toBe('monolith.html');
    expect(result.artifact.bytes).toBe(1234);
    expect(result.artifact.sha256).toBe('a'.repeat(64));
    expect(sandbox.stop).toHaveBeenCalledTimes(1);
  });
});
