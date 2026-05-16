/**
 * Computes SHA-256 hash of data using WebCrypto API.
 * Works in both Node.js and Cloudflare Workers.
 */
export async function sha256(data: ArrayBuffer | Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Constant-time string comparison to prevent timing attacks on API keys.
 * Uses byte-wise constant-time comparison for portability across runtimes.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBuf = encoder.encode(a);
  const bBuf = encoder.encode(b);
  if (aBuf.byteLength !== bBuf.byteLength) return false;

  // XOR-reduce all byte differences without early return.
  let diff = 0;
  for (let i = 0; i < aBuf.length; i += 1) {
    diff |= aBuf[i]! ^ bBuf[i]!;
  }
  return diff === 0;
}
