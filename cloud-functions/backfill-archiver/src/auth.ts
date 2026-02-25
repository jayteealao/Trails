/**
 * Byte-wise constant-time string comparison.
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBuf = encoder.encode(a);
  const bBuf = encoder.encode(b);
  if (aBuf.byteLength !== bBuf.byteLength) return false;

  let diff = 0;
  for (let i = 0; i < aBuf.length; i += 1) {
    diff |= aBuf[i]! ^ bBuf[i]!;
  }
  return diff === 0;
}

export function hasValidInternalApiKey(
  provided: string | null | undefined,
  expected: string
): boolean {
  if (!provided || provided.length === 0) return false;
  if (!expected || expected.length === 0) return false;
  return timingSafeEqualStrings(provided, expected);
}
