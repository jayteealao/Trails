/**
 * Detect the Cloudflare Sandbox RPC 32 MiB size-limit error from its message.
 *
 * Hit when a value crossing the host↔container RPC boundary (exec output capture
 * or `readFile`/`writeFile`) exceeds the serialized-RPC ceiling. monolith
 * base64-inlines every asset, so a heavy page can yield >32 MiB of output. This
 * is deterministic for a given input, so callers must treat it as
 * NON-retryable.
 */
export function isRpc32MiBLimit(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('32mib') ||
    lower.includes('33554432') ||
    lower.includes('message length too big') ||
    lower.includes('max allowed message length')
  );
}
