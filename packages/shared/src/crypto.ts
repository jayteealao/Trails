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
