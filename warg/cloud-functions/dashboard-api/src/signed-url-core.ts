import type { Firestore } from 'firebase-admin/firestore';
import { Storage } from '@google-cloud/storage';
import { ALL_ARCHIVE_KEYS } from './types.js';
import { resolveCanonicalItemId } from './util.js';

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

/** Response body returned to the caller — identical for the dashboard and the per-user app route. */
export interface SignedUrlResponseBody {
  url: string;
  expires_at: string;
  item_id: string;
  canonical_item_id: string;
  archive_key: string;
  archive_source_key: string;
}

export type ResolveAndSignResult =
  | { ok: true; body: SignedUrlResponseBody; objectPath: string }
  | { ok: false; status: number; error: string };

/**
 * Produces a V4 signed read URL for a GCS object. Injectable so the signing
 * (the one piece that talks to GCS / the IAM signBlob API) can be replaced in
 * unit tests without a real bucket or credentials.
 */
export type ArchiveSigner = (objectPath: string, expiresAt: Date) => Promise<string>;

const defaultSigner: ArchiveSigner = async (objectPath, expiresAt) => {
  const storage = new Storage({ projectId: GCS_PROJECT_ID });
  const file = storage.bucket(GCS_BUCKET).file(objectPath);
  const [signedUrl] = await file.getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: expiresAt,
  });
  return signedUrl;
};

const SAFE_ID_RE = /^[a-zA-Z0-9_-]{8,40}$/;

/**
 * Validate the `itemId` / `archiveKey` query params shared by both signed-URL
 * routes. Single source of truth for the request contract — boundary input is
 * `unknown` and narrowed here before any Firestore/GCS work.
 */
export function validateSignedUrlQuery(
  itemId: unknown,
  archiveKey: unknown
):
  | { ok: true; itemId: string; archiveKey: string }
  | { ok: false; status: number; error: string } {
  if (typeof itemId !== 'string' || !itemId || typeof archiveKey !== 'string' || !archiveKey) {
    return { ok: false, status: 400, error: 'Missing required query params: itemId, archiveKey' };
  }
  if (!SAFE_ID_RE.test(itemId)) {
    return { ok: false, status: 400, error: 'Invalid itemId format' };
  }
  if (!ALL_ARCHIVE_KEYS.includes(archiveKey as (typeof ALL_ARCHIVE_KEYS)[number])) {
    return { ok: false, status: 400, error: 'Invalid archiveKey' };
  }
  return { ok: true, itemId, archiveKey };
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

/** Strip the gs://bucket-name/ prefix to get the object path within the bucket. */
function toObjectPath(gcsPath: string): string {
  if (!gcsPath.startsWith('gs://')) return gcsPath;
  const withoutScheme = gcsPath.slice(5);
  const slashIdx = withoutScheme.indexOf('/');
  return slashIdx >= 0 ? withoutScheme.slice(slashIdx + 1) : withoutScheme;
}

/**
 * Shared signing core for both signed-URL routes.
 *
 * Proves ownership by reading `users/{ownerUid}/articles/{itemId}` (which also
 * yields the canonical id), resolves the requested archive (with key aliases),
 * and returns a short-lived V4 signed read URL for the GCS object. The two
 * route wrappers differ only in how `ownerUid` is obtained (a hardcoded
 * dashboard user vs. the verified Firebase token uid); the signing, resolution,
 * and validation contract live here exactly once.
 *
 * `itemId` and `archiveKey` must already be format-validated by the caller.
 */
export async function resolveAndSignArchive(params: {
  db: Firestore;
  ownerUid: string;
  itemId: string;
  archiveKey: string;
  sign?: ArchiveSigner;
}): Promise<ResolveAndSignResult> {
  const { db, ownerUid, itemId, archiveKey, sign = defaultSigner } = params;

  const userSnap = await db
    .collection('users')
    .doc(ownerUid)
    .collection('articles')
    .doc(itemId)
    .get();

  if (!userSnap.exists) {
    return { ok: false, status: 404, error: 'Article not found' };
  }

  const canonicalItemId = resolveCanonicalItemId(
    itemId,
    userSnap.data() as Record<string, unknown>
  );
  const docSnap = await db.collection('articles').doc(canonicalItemId).get();

  if (!docSnap.exists) {
    return { ok: false, status: 404, error: 'Canonical article not found' };
  }

  const doc = docSnap.data()!;
  const archives = doc['archives'] as Record<string, ArchiveRecord> | undefined;
  const resolved = resolveArchiveWithAlias(archives, archiveKey);
  const archive = resolved?.archive;

  if (!archive || archive.status !== 'success' || !archive.gcs_path) {
    return {
      ok: false,
      status: 404,
      error: `Archive '${archiveKey}' not available (status: ${archive?.status ?? 'absent'})`,
    };
  }

  const objectPath = toObjectPath(archive.gcs_path);
  const expiresAt = new Date(Date.now() + SIGNED_URL_EXPIRY_MINUTES * 60 * 1000);
  const signedUrl = await sign(objectPath, expiresAt);

  return {
    ok: true,
    objectPath,
    body: {
      url: signedUrl,
      expires_at: expiresAt.toISOString(),
      item_id: itemId,
      canonical_item_id: canonicalItemId,
      archive_key: archiveKey,
      archive_source_key: resolved?.sourceKey ?? archiveKey,
    },
  };
}
