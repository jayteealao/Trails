/**
 * Pure builders for the in-sandbox monolith/curl command lines (B1b).
 *
 * No runtime imports so the shell-quoting and flag wiring can be unit-tested
 * under plain Node/Vitest. The Sandbox fetches its input over its own network
 * (a presigned R2 URL) instead of the host→container `writeFile` RPC that was
 * returning HTTP 500 under concurrency.
 */

// Monolith CLI flags for creating clean single-file HTML.
export const MONOLITH_FLAGS = [
  '-j', // remove JavaScript
  '-a', // remove audio
  '-v', // remove video
  '-F' // remove frames/iframes
] as const;

export const SANDBOX_INPUT_PATH = '/workspace/in.html';
export const SANDBOX_OUTPUT_PATH = '/workspace/out.html';

/**
 * Quote an argument for POSIX shell execution.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/**
 * Monolith fetches the document directly from `documentUrl` (a presigned R2
 * GET URL). `-b baseUrl` resolves relative resources against the original
 * article, overriding the fetch URL as the base.
 */
export function buildMonolithUrlCommand(documentUrl: string, baseUrl: string): string {
  const args = [...MONOLITH_FLAGS, '-b', baseUrl, documentUrl, '-o', SANDBOX_OUTPUT_PATH];
  return `monolith ${args.map(shellQuote).join(' ')}`;
}

/**
 * Fallback step 1: curl writes the document to a local file using the
 * container's own network (not the failing host writeFile RPC).
 */
export function buildCurlCommand(documentUrl: string, outputPath: string = SANDBOX_INPUT_PATH): string {
  return `curl -sSL --fail --max-time 60 -o ${shellQuote(outputPath)} ${shellQuote(documentUrl)}`;
}

/**
 * Fallback step 2: monolith reads the curl-written local file. Identical base
 * resolution to the legacy writeFile path.
 */
export function buildMonolithFileCommand(baseUrl: string, inputPath: string = SANDBOX_INPUT_PATH): string {
  const args = [...MONOLITH_FLAGS, '-b', baseUrl, inputPath, '-o', SANDBOX_OUTPUT_PATH];
  return `monolith ${args.map(shellQuote).join(' ')}`;
}

/**
 * Upload the monolith output straight to R2 via a presigned PUT URL, then print
 * its sha256 + byte size. Routing the bytes over the container's network avoids
 * reading them back through the 32 MiB `readFile` RPC. The `&&` ensures the
 * hash/size only print when the upload succeeds.
 */
export function buildUploadAndHashCommand(
  putUrl: string,
  filePath: string = SANDBOX_OUTPUT_PATH
): string {
  const path = shellQuote(filePath);
  const url = shellQuote(putUrl);
  return (
    `curl -sSf -X PUT -H 'Content-Type: text/html' --upload-file ${path} ${url} && ` +
    `printf 'SHA256=%s\\nBYTES=%s\\n' "$(sha256sum ${path} | cut -d' ' -f1)" "$(stat -c %s ${path})"`
  );
}

export interface UploadResult {
  sha256: string;
  bytes: number;
}

/**
 * Parse the sha256 + byte size emitted by {@link buildUploadAndHashCommand}.
 * Returns undefined if either marker is absent (e.g. the upload step failed,
 * short-circuiting the `printf`).
 */
export function parseUploadOutput(stdout: string): UploadResult | undefined {
  const sha = stdout.match(/SHA256=([a-f0-9]{64})/);
  const bytes = stdout.match(/BYTES=(\d+)/);
  if (!sha || !bytes) return undefined;
  return { sha256: sha[1]!, bytes: Number(bytes[1]) };
}
