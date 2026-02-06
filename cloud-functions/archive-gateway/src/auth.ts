import type { Request, Response } from '@google-cloud/functions-framework';

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
  if (!providedKey || providedKey !== expectedKey) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}
