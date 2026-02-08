import { timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf-8');
  const bBuf = Buffer.from(b, 'utf-8');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Middleware to verify X-Internal-API-Key header.
 */
export function verifyApiKey(
  req: Request,
  res: Response,
  next: () => void
): void {
  const expectedKey = process.env['INTERNAL_API_KEY'];
  if (!expectedKey) {
    console.error('[auth] INTERNAL_API_KEY not configured');
    res.status(500).json({ error: 'Server misconfigured' });
    return;
  }

  const providedKey = req.headers['x-internal-api-key'];
  if (!providedKey || typeof providedKey !== 'string' || !safeEqual(providedKey, expectedKey)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}
