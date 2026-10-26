import type { DocumentData, Firestore } from 'firebase-admin/firestore';

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

/**
 * A stored shared-article id is used only when it matches this shape, so no
 * stored value can steer a read to another document path. The 1-40 range also
 * admits the short legacy ids the server still links.
 */
export const SHARED_ID_SHAPE = /^[a-zA-Z0-9_-]{1,40}$/;

const CHUNK_SIZE = 500;

/**
 * Returns the id of the shared article a user article is linked to: the
 * server-written `canonicalId`, else the user article's own id. The app can
 * write `resolvedId`, so it is never read here.
 */
export function resolveCanonicalFromUserDoc(
  itemId: string,
  userDoc: DocumentData | undefined
): string {
  const canonicalId: unknown = userDoc?.['canonicalId'];
  return typeof canonicalId === 'string' && SHARED_ID_SHAPE.test(canonicalId)
    ? canonicalId
    : itemId;
}

async function getAllChunked(db: Firestore, ids: string[]): Promise<Map<string, DocumentData>> {
  const found = new Map<string, DocumentData>();
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const refs = ids.slice(i, i + CHUNK_SIZE).map((id) => db.collection('articles').doc(id));
    if (refs.length === 0) continue;
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (snap.exists) found.set(snap.id, snap.data() ?? {});
    }
  }
  return found;
}

/**
 * Maps each shared article that was merged into another one to its winner, in
 * at most two `getAll` rounds. Only one hop is followed (the merge keeps chains
 * flat). Ids that are not merged duplicates, and duplicates whose winner is
 * missing, are absent from the map.
 */
export async function followMergedIntoOnce(
  db: Firestore,
  ids: string[]
): Promise<Map<string, string>> {
  const linked = await getAllChunked(db, [...new Set(ids)]);
  const targets = new Map<string, string>();
  for (const [id, data] of linked) {
    const target: unknown = data['mergedInto'];
    if (typeof target === 'string' && SHARED_ID_SHAPE.test(target) && target !== id) {
      targets.set(id, target);
    }
  }
  if (targets.size === 0) return new Map();
  const winners = await getAllChunked(db, [...new Set(targets.values())]);
  const result = new Map<string, string>();
  for (const [id, target] of targets) {
    if (winners.has(target)) result.set(id, target);
  }
  return result;
}

export function buildPocket(
  userDoc: DocumentData,
  canonicalItemId: string
): Record<string, unknown> {
  return {
    favorite: userDoc['favorite'] ?? '',
    resolved_id:
      typeof userDoc['resolvedId'] === 'string' &&
      userDoc['resolvedId'].trim().length > 0
        ? userDoc['resolvedId']
        : canonicalItemId,
    status: userDoc['status'] ?? '',
    time_added: userDoc['timeAdded'] ?? 0,
    time_read: userDoc['timeRead'] ?? 0,
  };
}
