import type {
  DocumentData,
  DocumentReference,
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import {
  SHARED_ID_SHAPE,
  extractDomain,
  followMergedIntoOnce,
  resolveCanonicalFromUserDoc,
} from './canonical.js';

// Groups the backfill page of user articles by the shared article each one links to.
// It lives outside index.ts so the function entry exports only deployed functions.
// The grouping makes no per-URL query: the save trigger dedupes on the normalized
// URL and writes the link, so the server-written canonicalId (else the item id)
// and one mergedInto hop decide the group.

export interface CanonicalCandidate {
  canonicalItemId: string;
  url: string;
  domain: string;
  sourceUserRefs: Array<DocumentReference<DocumentData>>;
  primaryUserData: DocumentData;
  /** True when a user article of the group carries a server-written canonicalId. */
  fromServerLink: boolean;
}

export async function resolveCanonicalCandidates(
  db: FirebaseFirestore.Firestore,
  userDocs: Array<QueryDocumentSnapshot<DocumentData>>
): Promise<CanonicalCandidate[]> {
  const resolved: Array<{
    userDoc: QueryDocumentSnapshot<DocumentData>;
    url: string;
    id: string;
    fromServerLink: boolean;
  }> = [];

  for (const userDoc of userDocs) {
    const userData = userDoc.data();
    const urlRaw = userData['url'];
    const url = typeof urlRaw === 'string' ? urlRaw.trim() : '';
    if (!url) continue;

    const canonicalId: unknown = userData['canonicalId'];
    resolved.push({
      userDoc,
      url,
      id: resolveCanonicalFromUserDoc(userDoc.id, userData),
      fromServerLink: typeof canonicalId === 'string' && SHARED_ID_SHAPE.test(canonicalId),
    });
  }

  // A link that names a merged duplicate is grouped under the merge winner.
  const winners = await followMergedIntoOnce(db, [...new Set(resolved.map((r) => r.id))]);
  const byCanonical = new Map<string, CanonicalCandidate>();

  for (const { userDoc, url, id, fromServerLink } of resolved) {
    const canonicalItemId = winners.get(id) ?? id;
    const current = byCanonical.get(canonicalItemId);
    if (!current) {
      byCanonical.set(canonicalItemId, {
        canonicalItemId,
        url,
        domain: extractDomain(url),
        sourceUserRefs: [userDoc.ref],
        primaryUserData: userDoc.data(),
        fromServerLink,
      });
      continue;
    }

    current.sourceUserRefs.push(userDoc.ref);
    current.fromServerLink ||= fromServerLink;
  }

  return Array.from(byCanonical.values());
}
