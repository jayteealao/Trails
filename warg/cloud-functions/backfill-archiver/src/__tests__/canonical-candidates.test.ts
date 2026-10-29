import assert from 'node:assert/strict';
import test from 'node:test';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { resolveCanonicalCandidates } from '../canonical-candidates.js';

// Fake Firestore for the backfill grouping: articles/{id} through getAll, and the
// per-URL lookup `where('url', '==', url).limit(1).get()` that finds nothing.
// Every article read is logged by id.
function fakeDb(articles: Record<string, Record<string, unknown>>) {
  const reads: string[] = [];
  const db = {
    collection: () => ({
      doc: (id: string) => ({ id }),
      where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
    }),
    async getAll(...refs: Array<{ id: string }>) {
      return refs.map(({ id }) => {
        reads.push(id);
        return { id, exists: articles[id] !== undefined, data: () => articles[id] };
      });
    },
  };
  // Boundary cast: the fake implements only the slice of Firestore the grouping uses.
  return { db: db as unknown as FirebaseFirestore.Firestore, reads };
}

function userDoc(id: string, data: DocumentData): QueryDocumentSnapshot<DocumentData> {
  // Boundary cast: a user article snapshot needs only id, data() and ref here.
  return { id, data: () => data, ref: { path: `users/u/articles/${id}` } } as unknown as QueryDocumentSnapshot<DocumentData>;
}

const refPaths = (refs: Array<{ path: string }>) => refs.map((r) => r.path);

test('groups a user article under its canonicalId, not a foreign resolvedId', async () => {
  const { db, reads } = fakeDb({ 'own-share1': {}, 'victim-sh1': {} });

  const candidates = await resolveCanonicalCandidates(db, [
    userDoc('item-0001', {
      url: 'https://example.com/a',
      canonicalId: 'own-share1',
      resolvedId: 'victim-sh1',
    }),
  ]);

  assert.deepEqual(
    candidates.map((c) => c.canonicalItemId),
    ['own-share1']
  );
  assert.ok(!reads.includes('victim-sh1'));
});

test('a link to a merged duplicate and a link to its winner end in one candidate', async () => {
  const { db } = fakeDb({ 'loser-0001': { mergedInto: 'winner-001' }, 'winner-001': {} });

  const candidates = await resolveCanonicalCandidates(db, [
    userDoc('item-0001', { url: 'https://example.com/a', canonicalId: 'loser-0001' }),
    userDoc('item-0002', { url: 'https://example.com/a?utm_source=x', canonicalId: 'winner-001' }),
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.canonicalItemId, 'winner-001');
  assert.deepEqual(refPaths(candidates[0]!.sourceUserRefs as unknown as Array<{ path: string }>), [
    'users/u/articles/item-0001',
    'users/u/articles/item-0002',
  ]);
});

test('a user article with no canonicalId and no URL match groups under its own id', async () => {
  const { db } = fakeDb({});

  const candidates = await resolveCanonicalCandidates(db, [
    userDoc('item-0003', { url: 'https://example.com/b', resolvedId: 'victim-sh1' }),
  ]);

  assert.deepEqual(
    candidates.map((c) => c.canonicalItemId),
    ['item-0003']
  );
});
