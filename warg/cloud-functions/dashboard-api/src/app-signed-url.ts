import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { Request, Response } from 'express';
import {
  resolveAndSignArchive,
  validateSignedUrlQuery,
  type ArchiveSigner,
} from './signed-url-core.js';

/**
 * GET /app/signed-url?itemId=X&archiveKey=Y handler (per-user, Firebase-token auth).
 *
 * Ownership is the verified token `uid` passed in by the auth middleware — the
 * signed URL is returned only if that user owns
 * `users/{uid}/articles/{itemId}`. The full signed URL is NEVER logged: it
 * grants read access to the object for its TTL, so only the itemId, archiveKey,
 * and object path are recorded.
 */
export async function handleAppSignedUrl(
  req: Request,
  res: Response,
  uid: string,
  db: Firestore = getFirestore(),
  sign?: ArchiveSigner
): Promise<void> {
  const query = validateSignedUrlQuery(req.query['itemId'], req.query['archiveKey']);
  if (!query.ok) {
    res.status(query.status).json({ error: query.error });
    return;
  }

  const result = await resolveAndSignArchive({
    db,
    ownerUid: uid,
    itemId: query.itemId,
    archiveKey: query.archiveKey,
    sign,
  });

  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  console.log(
    `[app-signed-url] signed itemId=${query.itemId} archiveKey=${query.archiveKey} object=${result.objectPath}`
  );
  res.json(result.body);
}
