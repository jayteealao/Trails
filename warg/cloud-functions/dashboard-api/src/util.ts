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
export function resolveCanonicalItemId(
  itemId: string,
  userDoc: Record<string, unknown> | undefined
): string {
  const canonicalId = userDoc?.['canonicalId'];
  return typeof canonicalId === 'string' && SHARED_ID_SHAPE.test(canonicalId)
    ? canonicalId
    : itemId;
}

/** The shared article a merged duplicate points at, when `data` is such a duplicate. */
export function mergedTargetOf(id: string, data: DocumentData | undefined): string | undefined {
  const target: unknown = data?.['mergedInto'];
  return typeof target === 'string' && SHARED_ID_SHAPE.test(target) && target !== id
    ? target
    : undefined;
}

export interface SharedArticle {
  /** The id the user article links to. */
  linkId: string;
  /** The id actually read: the merge winner when the link names a merged duplicate. */
  id: string;
  data: DocumentData;
}

/**
 * Reads `articles/{linkId}` and, when it was merged into another shared
 * article, that article instead (one hop only). A merged duplicate whose winner
 * is missing is returned as is. Returns undefined when the linked doc is missing.
 */
export async function readSharedArticle(
  db: Firestore,
  linkId: string
): Promise<SharedArticle | undefined> {
  const snap = await db.collection('articles').doc(linkId).get();
  if (!snap.exists) return undefined;
  const data = snap.data() ?? {};
  const target = mergedTargetOf(linkId, data);
  if (target) {
    const winner = await db.collection('articles').doc(target).get();
    if (winner.exists) return { linkId, id: target, data: winner.data() ?? {} };
  }
  return { linkId, id: linkId, data };
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
 * The batch form of {@link readSharedArticle}: at most two `getAll` rounds (in
 * chunks of 500), the linked docs and then only the winners of merged
 * duplicates. The map is keyed by link id; missing linked docs are absent.
 */
export async function readSharedArticles(
  db: Firestore,
  linkIds: string[]
): Promise<Map<string, SharedArticle>> {
  const linked = await getAllChunked(db, [...new Set(linkIds)]);
  const targets = new Map<string, string>();
  for (const [id, data] of linked) {
    const target = mergedTargetOf(id, data);
    if (target) targets.set(id, target);
  }
  const winners =
    targets.size > 0
      ? await getAllChunked(db, [...new Set(targets.values())])
      : new Map<string, DocumentData>();
  const result = new Map<string, SharedArticle>();
  for (const [linkId, data] of linked) {
    const target = targets.get(linkId);
    const winnerData = target ? winners.get(target) : undefined;
    result.set(
      linkId,
      target && winnerData
        ? { linkId, id: target, data: winnerData }
        : { linkId, id: linkId, data }
    );
  }
  return result;
}

export function timestampToIso(ts: unknown): string {
  if (!ts) return '';
  // Firestore Timestamp object
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts) {
    return (ts as { toDate: () => Date }).toDate().toISOString();
  }
  // Already a string
  if (typeof ts === 'string') return ts;
  return '';
}
