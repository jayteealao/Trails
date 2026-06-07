import { FieldPath } from 'firebase-admin/firestore';
import type {
  CollectionReference,
  DocumentData,
  Firestore,
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore';

import { ARTICLE_MARKERS_COLLECTION } from './keys.js';

const USERS_COLLECTION = 'users';
const ARTICLES_COLLECTION = 'articles';

/** `users/{uid}/articles` — the per-user article collection. */
export function userArticlesCollection(
  db: Firestore,
  uid: string,
): CollectionReference<DocumentData> {
  return db.collection(USERS_COLLECTION).doc(uid).collection(ARTICLES_COLLECTION);
}

/** `users/{uid}/articleMarkers` — the per-user existence-marker collection. */
export function markersCollection(
  db: Firestore,
  uid: string,
): CollectionReference<DocumentData> {
  return db
    .collection(USERS_COLLECTION)
    .doc(uid)
    .collection(ARTICLE_MARKERS_COLLECTION);
}

/** Read the article doc's `resolvedId` field as a raw string (or undefined). */
export function extractResolvedId(data: DocumentData): string | undefined {
  const raw = data['resolvedId'];
  return typeof raw === 'string' ? raw : undefined;
}

/**
 * Page through `users/{uid}/articles` ordered by document id, yielding each
 * snapshot. Single-user per-collection paging is intentional: a
 * `collectionGroup('articles')` iterator would also sweep the root `articles`
 * dedup index, whose docs have no parent user.
 */
export async function* streamUserArticles(
  db: Firestore,
  uid: string,
  pageSize = 250,
): AsyncGenerator<QueryDocumentSnapshot<DocumentData>> {
  const collection = userArticlesCollection(db, uid);
  let cursor: string | null = null;

  for (;;) {
    let query = collection.orderBy(FieldPath.documentId()).limit(pageSize);
    if (cursor) query = query.startAfter(cursor);

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const doc of snapshot.docs) yield doc;

    if (snapshot.docs.length < pageSize) break;
    cursor = snapshot.docs[snapshot.docs.length - 1]!.id;
  }
}

/** Read the user's existing marker doc ids into a Set (one paged scan). */
export async function readExistingMarkerKeys(
  db: Firestore,
  uid: string,
): Promise<Set<string>> {
  const collection = markersCollection(db, uid);
  const keys = new Set<string>();
  const pageSize = 500;
  let cursor: string | null = null;

  for (;;) {
    let query = collection.orderBy(FieldPath.documentId()).limit(pageSize);
    if (cursor) query = query.startAfter(cursor);

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const doc of snapshot.docs) keys.add(doc.id);

    if (snapshot.docs.length < pageSize) break;
    cursor = snapshot.docs[snapshot.docs.length - 1]!.id;
  }

  return keys;
}
