// Direct writes to an articles document: the article write check must report
// each line that ends with a `fixture:` comment, and no other line.
import { getFirestore } from 'firebase-admin/firestore';

export async function directSet(id: string): Promise<void> {
  const ref = getFirestore().collection('articles').doc(id);
  await ref.set({ title: 'x' }, { merge: true }); // fixture: direct set
}

export async function aliasedUpdate(id: string): Promise<void> {
  const ref = getFirestore().collection('articles').doc(id);
  const alias = ref;
  await alias.update({ title: 'x' }); // fixture: aliased update
}

export async function transactionCreate(id: string): Promise<void> {
  const db = getFirestore();
  await db.runTransaction(async (tx) => {
    tx.create(db.collection('articles').doc(id), { title: 'x' }); // fixture: transaction create
  });
}

export async function bulkSet(id: string): Promise<void> {
  const db = getFirestore();
  const writer = db.bulkWriter();
  void writer.set(db.collection('articles').doc(id), { title: 'x' }); // fixture: bulk set
  await writer.close();
}

export async function userArticleSet(uid: string, id: string): Promise<void> {
  const ref = getFirestore().collection('users').doc(uid).collection('articles').doc(id);
  await ref.set({ title: 'x' }); // fixture: user article set
}
