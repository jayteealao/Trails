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

  it('reads the page and writes the output through the R2 handler host', async () => {
    const sandbox = fakeSandbox([execOk(), execOk(UPLOAD_OK_STDOUT)]);

    await runMonolithInSandbox(
      createEnv(),
      'req-success',
      'archives/req-success/raw/rendered.html',
      'https://example.com'
    );

    // Test boundary: the fake exec is declared without parameters, so its
    // recorded calls are typed as empty tuples; the real call passes the command.
    const commands = sandbox.exec.mock.calls.map(call => String((call as unknown[])[0]));
    expect(commands[0]).toContain('http://r2.monolith.internal/archives/req-success/raw/rendered.html');
    expect(commands[1]).toContain('http://r2.monolith.internal/archives/req-success/derived/monolith.html');
    expect(commands.join(' ')).not.toContain('X-Amz-');
  });

  it("refuses an input key that is not the request's own rendered page, before any exec", async () => {
    const sandbox = fakeSandbox([]);

    await expect(
      runMonolithInSandbox(
        createEnv(),
        'req-own',
        'archives/req-other/raw/rendered.html',
        'https://example.com'
      )
    ).rejects.toMatchObject({ code: 'INVALID_INPUT_KEY', status: 400, retryable: false });

    expect(sandbox.exec).not.toHaveBeenCalled();
    expect(getSandboxMock).not.toHaveBeenCalled();
  });

  it('keys the sandbox off the request id (no warm pool)', async () => {
    fakeSandbox([execOk(), execOk(UPLOAD_OK_STDOUT)]);

    const result = await runMonolithInSandbox(
      createEnv(),
      'Req-Keyed-123',
      'archives/Req-Keyed-123/raw/rendered.html',
      'https://example.com'
    );

    expect(result.sandboxId).toBe('req-keyed-123');
    expect(getSandboxMock).toHaveBeenCalledWith(expect.anything(), 'req-keyed-123', { transport: 'rpc' });
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

  it.each([
    ['the upload', [execOk(), execFail('curl: (22) The requested URL returned error: 403')]],
    [
      'the download',
      [execFail('monolith: fetch failed'), execFail('curl: (22) The requested URL returned error: 403')]
    ]
  ])('reports a rejected storage key when R2 refuses %s', async (_path, results) => {
    const sandbox = fakeSandbox(results);

    await expect(
      runMonolithInSandbox(
        createEnv(),
        'req-r2-rejected',
        'archives/req-r2-rejected/raw/rendered.html',
        'https://example.com'
      )
    ).rejects.toMatchObject({ code: 'R2_CREDENTIAL_INVALID', status: 502, retryable: false });

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
      execFail('monolith: document fetch error'),
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

describe('runMonolithInSandbox signed URL redaction', () => {
  const SIGNED = 'https://r2.example/doc?X-Amz-Credential=key-id&X-Amz-Signature=secret-sig';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function logged(...spies: Array<{ mock: { calls: unknown[][] } }>): string {
    return JSON.stringify(spies.flatMap(spy => spy.mock.calls));
  }

  it('keeps the signature out of logs and the thrown error when output echoes the URL', async () => {
    fakeSandbox([execFail(`monolith: failed ${SIGNED}`), execFail(`curl: (22) ${SIGNED}`)]);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const error = await runMonolithInSandbox(
      createEnv(),
      'req-redact',
      'archives/req-redact/raw/rendered.html',
      'https://example.com'
    ).catch((caught: unknown) => caught);

    expect(String(error)).toContain('X-Amz-Signature=[redacted]');
    expect(String(error)).not.toContain('secret-sig');
    expect(logged(warnSpy, errorSpy)).not.toContain('secret-sig');
    expect(logged(warnSpy, errorSpy)).not.toContain('key-id');
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('keeps the signature out of the error when exec itself throws with the command', async () => {
    const sandbox = fakeSandbox([]);
    sandbox.exec.mockRejectedValue(new Error(`exec failed: ${SIGNED}`));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const error = await runMonolithInSandbox(
      createEnv(),
      'req-redact-throw',
      'archives/req-redact-throw/raw/rendered.html',
      'https://example.com'
    ).catch((caught: unknown) => caught);

    expect(String(error)).not.toContain('secret-sig');
    expect(logged(warnSpy, errorSpy)).not.toContain('secret-sig');
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
