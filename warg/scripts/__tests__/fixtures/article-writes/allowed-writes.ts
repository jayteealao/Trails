// Calls the article write check must not report: collection methods that are
// not Firestore writes, and Firestore writes to other documents that carry
// the marker on their line or the line above.
import { getFirestore } from 'firebase-admin/firestore';

export function collections(): number {
  const seen = new Map<string, number>();
  seen.set('a', 1);
  const ids = new Set<string>();
  ids.add('a');
  return seen.size + ids.size;
}

export async function trackerWrite(): Promise<void> {
  const db = getFirestore();
  const trackerRef = db.collection('backfill_state').doc('tracker');
  await db.runTransaction(async (tx) => {
    tx.set(trackerRef, { cursor: 1 }); // article-write-check: not-an-article (backfill tracker)
  });
}

export async function markerWrite(uid: string, id: string): Promise<void> {
  const ref = getFirestore().collection('users').doc(uid).collection('articleMarkers').doc(id);
  // article-write-check: not-an-article (article marker)
  await ref.set({ id });
}
