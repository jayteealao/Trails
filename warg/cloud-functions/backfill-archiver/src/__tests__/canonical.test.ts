import assert from 'node:assert/strict';
import test from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import {
  buildPocket,
  followMergedIntoOnce,
  resolveCanonicalFromUserDoc,
} from '../canonical.js';

test('resolveCanonicalFromUserDoc returns canonicalId when present', () => {
  const canonical = resolveCanonicalFromUserDoc('abc123', { canonicalId: 'xyz999' });
  assert.equal(canonical, 'xyz999');
});

test('resolveCanonicalFromUserDoc falls back to itemId', () => {
  const canonical = resolveCanonicalFromUserDoc('abc123', { canonicalId: '   ' });
  assert.equal(canonical, 'abc123');
});

test('resolveCanonicalFromUserDoc ignores the app-written resolvedId', () => {
  assert.equal(resolveCanonicalFromUserDoc('abc123', { resolvedId: 'xyz999' }), 'abc123');
  assert.equal(
    resolveCanonicalFromUserDoc('abc123', { resolvedId: 'victim-sh1', canonicalId: 'own-share1' }),
    'own-share1'
  );
});

// Fake Firestore: articles/{id} reads through getAll only; counts the rounds.
function fakeDb(articles: Record<string, Record<string, unknown>>) {
  const counter = { getAllCalls: 0 };
  const db = {
    collection: () => ({
      doc: (id: string) => ({ id }),
    }),
    async getAll(...refs: Array<{ id: string }>) {
      counter.getAllCalls += 1;
      return refs.map(({ id }) => ({
        id,
        exists: articles[id] !== undefined,
        data: () => articles[id],
      }));
    },
  };
  // Boundary cast: the fake implements only the slice of Firestore the helper uses.
  return { db: db as unknown as Firestore, counter };
}

test('followMergedIntoOnce maps a merged duplicate to its existing winner', async () => {
  const { db, counter } = fakeDb({
    'loser-0001': { mergedInto: 'winner-001' },
    'winner-001': { mergedInto: 'other-0001' },
    'plain-001': {},
  });

  const winners = await followMergedIntoOnce(db, ['loser-0001', 'plain-001', 'winner-001']);

  // winner-001's own mergedInto names a missing article, so it is not mapped.
  assert.deepEqual([...winners], [['loser-0001', 'winner-001']]);
  assert.equal(counter.getAllCalls, 2);
});

test('followMergedIntoOnce leaves out a duplicate whose winner is missing, and plain articles', async () => {
  const { db, counter } = fakeDb({
    'loser-0002': { mergedInto: 'gone-00001' },
    'plain-001': {},
  });

  const winners = await followMergedIntoOnce(db, ['loser-0002', 'plain-001']);

  assert.equal(winners.size, 0);
  assert.equal(counter.getAllCalls, 2);

  const none = await followMergedIntoOnce(fakeDb({ 'plain-001': {} }).db, ['plain-001']);
  assert.equal(none.size, 0);
});

test('buildPocket falls back resolved_id to canonical id', () => {
  const pocket = buildPocket(
    { favorite: '1', status: '0', timeAdded: 10, timeRead: 20 },
    'canonical-id'
  );
  assert.equal(pocket.resolved_id, 'canonical-id');
});
