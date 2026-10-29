import { timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';
import { acceptedCallerKeys } from './secrets.js';

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
 * Middleware to verify the X-Internal-API-Key header. It accepts the
 * dashboard's own key, and the old shared key only while the key-rotation
 * switch is on. Every accepted key is compared, so the time taken does not
 * depend on which key matched.
 */
export function verifyApiKey(
  req: Request,
  res: Response,
  next: () => void
): void {
  const { own, old } = acceptedCallerKeys();
  if (!own) {
    console.error('[auth] DASHBOARD_API_KEY not configured');
    res.status(500).json({ error: 'Server misconfigured' });
    return;
  }

  const providedKey = req.headers['x-internal-api-key'];
  if (!providedKey || typeof providedKey !== 'string') {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const matched = [own, old]
    .filter(Boolean)
    .map((key) => safeEqual(providedKey, key))
    .some(Boolean);
  if (!matched) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}
