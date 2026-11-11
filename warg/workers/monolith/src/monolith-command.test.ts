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
import { r2HandlerUrl } from './r2-outbound.js';

const INPUT_URL = r2HandlerUrl('archives/req/raw/rendered.html');
const OUTPUT_URL = r2HandlerUrl('archives/req/derived/monolith.html');

describe('shellQuote', () => {
  it('wraps a plain value in single quotes', () => {
    expect(shellQuote('hello')).toBe("'hello'");
  });

  it('escapes embedded single quotes', () => {
    expect(shellQuote("a'b")).toBe("'a'\"'\"'b'");
  });

  it('keeps URL query strings intact inside the quotes', () => {
    const url = 'http://r2.monolith.internal/archives/req/raw/rendered.html?a=1&b=2';
    expect(shellQuote(url)).toBe(`'${url}'`);
  });
});

describe('buildMonolithUrlCommand', () => {
  it('passes the handler URL as the target and base as -b, with the clean flags', () => {
    const cmd = buildMonolithUrlCommand(INPUT_URL, 'https://blog.example/post');
    expect(cmd).toBe(
      "monolith '-j' '-a' '-v' '-F' '-b' 'https://blog.example/post' 'http://r2.monolith.internal/archives/req/raw/rendered.html' '-o' '/workspace/out.html'"
    );
    expect(cmd).toContain(SANDBOX_OUTPUT_PATH);
  });
});

describe('buildCurlCommand', () => {
  it('writes the handler URL to the default input path with --fail', () => {
    const cmd = buildCurlCommand(INPUT_URL);
    expect(cmd).toBe(
      "curl -sSL --fail --max-time 60 -o '/workspace/in.html' 'http://r2.monolith.internal/archives/req/raw/rendered.html'"
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
  it('PUTs the output to the handler host then prints sha256 + size, gated on upload success', () => {
    const cmd = buildUploadAndHashCommand(OUTPUT_URL);
    expect(cmd).toContain(
      "curl -sSf -X PUT -H 'Content-Type: text/html' -H 'Expect:' --upload-file '/workspace/out.html' 'http://r2.monolith.internal/archives/req/derived/monolith.html'"
    );
    expect(cmd).toContain("-H 'Expect:'");
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
