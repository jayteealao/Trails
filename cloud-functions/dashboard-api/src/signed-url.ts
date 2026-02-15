import { getFirestore } from 'firebase-admin/firestore';
import { Storage } from '@google-cloud/storage';
import type { Request, Response } from 'express';
import { ALL_ARCHIVE_KEYS } from './types.js';

const GCS_BUCKET = process.env['GCS_BUCKET'] || 'htbase-archives-standard';
const GCS_PROJECT_ID = process.env['GCS_PROJECT_ID'] || 'trails-414917';
const SIGNED_URL_EXPIRY_MINUTES = 15;
const ARCHIVE_ALIASES: Partial<Record<string, readonly string[]>> = {
  readability: ['readability', 'readability_json'],
  markdown: ['markdown', 'readability_md'],
};

interface ArchiveRecord {
  status?: string;
  gcs_path?: string;
}

function resolveArchiveWithAlias(
  archives: Record<string, ArchiveRecord> | undefined,
  archiveKey: string
): { sourceKey: string; archive: ArchiveRecord } | undefined {
  if (!archives) return undefined;
  const aliases = ARCHIVE_ALIASES[archiveKey] ?? [archiveKey];
  for (const key of aliases) {
    const archive = archives[key];
    if (archive) {
      return { sourceKey: key, archive };
    }
  }
  return undefined;
}

/**
 * GET /signed-url?itemId=X&archiveKey=Y handler.
 * Returns a signed GCS download URL for the specified archive artifact.
 */
export async function handleSignedUrl(
  req: Request,
  res: Response
): Promise<void> {
  const itemId = req.query['itemId'] as string | undefined;
  const archiveKey = req.query['archiveKey'] as string | undefined;

  if (!itemId || !archiveKey) {
    res.status(400).json({ error: 'Missing required query params: itemId, archiveKey' });
    return;
  }

  const SAFE_ID_RE = /^[a-zA-Z0-9_-]{8,40}$/;
  if (!SAFE_ID_RE.test(itemId)) {
    res.status(400).json({ error: 'Invalid itemId format' });
    return;
  }

  if (!ALL_ARCHIVE_KEYS.includes(archiveKey as typeof ALL_ARCHIVE_KEYS[number])) {
    res.status(400).json({ error: 'Invalid archiveKey' });
    return;
  }

  const db = getFirestore();
  const docSnap = await db.collection('articles').doc(itemId).get();

  if (!docSnap.exists) {
    res.status(404).json({ error: 'Article not found' });
    return;
  }

  const doc = docSnap.data()!;
  const archives = doc['archives'] as Record<string, ArchiveRecord> | undefined;
  const resolved = resolveArchiveWithAlias(archives, archiveKey);
  const archive = resolved?.archive;

  if (!archive || archive.status !== 'success' || !archive.gcs_path) {
    res.status(404).json({ error: `Archive '${archiveKey}' not available (status: ${archive?.status ?? 'absent'})` });
    return;
  }

  // Strip gs://bucket-name/ prefix to get the object path
  const gcsPath = archive.gcs_path;
  let objectPath: string;
  if (gcsPath.startsWith('gs://')) {
    // Format: gs://bucket-name/path/to/object
    const withoutScheme = gcsPath.slice(5);
    const slashIdx = withoutScheme.indexOf('/');
    objectPath = slashIdx >= 0 ? withoutScheme.slice(slashIdx + 1) : withoutScheme;
  } else {
    objectPath = gcsPath;
  }

  const storage = new Storage({ projectId: GCS_PROJECT_ID });
  const bucket = storage.bucket(GCS_BUCKET);
  const file = bucket.file(objectPath);

  const expiresAt = new Date(Date.now() + SIGNED_URL_EXPIRY_MINUTES * 60 * 1000);

  const [signedUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: expiresAt,
  });

  res.json({
    url: signedUrl,
    expires_at: expiresAt.toISOString(),
    archive_key: archiveKey,
    archive_source_key: resolved?.sourceKey ?? archiveKey,
  });
}
