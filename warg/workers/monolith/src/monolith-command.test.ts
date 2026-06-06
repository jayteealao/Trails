import { describe, expect, it } from 'vitest';
import {
  buildCurlCommand,
  buildMonolithFileCommand,
  buildMonolithUrlCommand,
  buildUploadAndHashCommand,
  parseUploadOutput,
  shellQuote,
  SANDBOX_INPUT_PATH,
  SANDBOX_OUTPUT_PATH
} from './monolith-command.js';

describe('shellQuote', () => {
  it('wraps a plain value in single quotes', () => {
    expect(shellQuote('hello')).toBe("'hello'");
  });

  it('escapes embedded single quotes', () => {
    expect(shellQuote("a'b")).toBe("'a'\"'\"'b'");
  });

  it('keeps URL query strings intact inside the quotes', () => {
    const url = 'https://acct.r2.cloudflarestorage.com/b/k?X-Amz-Signature=abc&X-Amz-Expires=900';
    expect(shellQuote(url)).toBe(`'${url}'`);
  });
});

describe('buildMonolithUrlCommand', () => {
  it('passes the document URL as the target and base as -b, with the clean flags', () => {
    const cmd = buildMonolithUrlCommand('https://r2.example/doc?sig=1', 'https://blog.example/post');
    expect(cmd).toBe(
      "monolith '-j' '-a' '-v' '-F' '-b' 'https://blog.example/post' 'https://r2.example/doc?sig=1' '-o' '/workspace/out.html'"
    );
    expect(cmd).toContain(SANDBOX_OUTPUT_PATH);
  });
});

describe('buildCurlCommand', () => {
  it('writes the URL to the default input path with --fail', () => {
    const cmd = buildCurlCommand('https://r2.example/doc?sig=1');
    expect(cmd).toBe(
      "curl -sSL --fail --max-time 60 -o '/workspace/in.html' 'https://r2.example/doc?sig=1'"
    );
    expect(cmd).toContain(SANDBOX_INPUT_PATH);
  });
});

describe('buildMonolithFileCommand', () => {
  it('reads the local input path with the base override', () => {
    const cmd = buildMonolithFileCommand('https://blog.example/post');
    expect(cmd).toBe(
      "monolith '-j' '-a' '-v' '-F' '-b' 'https://blog.example/post' '/workspace/in.html' '-o' '/workspace/out.html'"
    );
  });
});

describe('buildUploadAndHashCommand', () => {
  it('PUTs the output then prints sha256 + size, gated on upload success', () => {
    const cmd = buildUploadAndHashCommand('https://r2.example/key?sig=1');
    expect(cmd).toContain("curl -sSf -X PUT -H 'Content-Type: text/html' --upload-file '/workspace/out.html' 'https://r2.example/key?sig=1'");
    expect(cmd).toContain('&&');
    expect(cmd).toContain('sha256sum');
    expect(cmd).toContain('stat -c %s');
    expect(cmd).toContain('SHA256=%s');
  });
});

describe('parseUploadOutput', () => {
  const sha = 'a'.repeat(64);

  it('extracts sha256 and bytes from the printf markers', () => {
    expect(parseUploadOutput(`SHA256=${sha}\nBYTES=31111\n`)).toEqual({ sha256: sha, bytes: 31111 });
  });

  it('returns undefined when the upload short-circuited (no markers)', () => {
    expect(parseUploadOutput('curl: (22) The requested URL returned error: 403')).toBeUndefined();
  });

  it('returns undefined when only one marker is present', () => {
    expect(parseUploadOutput(`SHA256=${sha}\n`)).toBeUndefined();
    expect(parseUploadOutput('BYTES=10\n')).toBeUndefined();
  });
});
