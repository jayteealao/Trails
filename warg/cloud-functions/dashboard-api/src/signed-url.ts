import { getFirestore } from 'firebase-admin/firestore';
import type { Request, Response } from 'express';
import { getDashboardUserId } from './config.js';
import { resolveAndSignArchive, validateSignedUrlQuery } from './signed-url-core.js';

/**
 * GET /signed-url?itemId=X&archiveKey=Y handler (dashboard, API-key auth).
 * Returns a signed GCS download URL for the specified archive artifact,
 * scoped to the single hardcoded dashboard user.
 */
export async function handleSignedUrl(
  req: Request,
  res: Response
): Promise<void> {
  const query = validateSignedUrlQuery(req.query['itemId'], req.query['archiveKey']);
  if (!query.ok) {
    res.status(query.status).json({ error: query.error });
    return;
  }

  const result = await resolveAndSignArchive({
    db: getFirestore(),
    ownerUid: getDashboardUserId(),
    itemId: query.itemId,
    archiveKey: query.archiveKey,
  });

  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  res.json(result.body);
}
