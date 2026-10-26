import test from 'node:test';
import assert from 'node:assert/strict';
import { readSharedArticle, readSharedArticles, resolveCanonicalItemId } from '../util.js';
import { makeFakeDb } from './fake-firestore.js';

// ── resolveCanonicalItemId ──────────────────────────────────────────────────

test('canonicalId wins over a foreign resolvedId', () => {
  assert.equal(
    resolveCanonicalItemId('item1234', { canonicalId: 'own-share1', resolvedId: 'victim-sh1' }),
    'own-share1'
  );
});

test('no canonicalId falls back to the item id, even with a resolvedId', () => {
  assert.equal(resolveCanonicalItemId('item1234', { resolvedId: 'victim-sh1' }), 'item1234');
  assert.equal(resolveCanonicalItemId('item1234', undefined), 'item1234');
});

test('a canonicalId outside the id shape falls back to the item id', () => {
  for (const canonicalId of ['', '   ', 42, null, 'a/b', 'x'.repeat(41)]) {
    assert.equal(resolveCanonicalItemId('item1234', { canonicalId }), 'item1234', String(canonicalId));
  }
});

// ── readSharedArticle ───────────────────────────────────────────────────────

test('readSharedArticle follows mergedInto exactly once', async () => {
  const { db, log } = makeFakeDb({
    articles: {
      'stub-aaa1': { mergedInto: 'stub-bbb1', title: 'A' },
      'stub-bbb1': { mergedInto: 'stub-ccc1', title: 'B' },
      'stub-ccc1': { title: 'C' },
    },
  });

  const shared = await readSharedArticle(db, 'stub-aaa1');

  assert.deepEqual(shared, {
    linkId: 'stub-aaa1',
    id: 'stub-bbb1',
    data: { mergedInto: 'stub-ccc1', title: 'B' },
  });
  assert.ok(!log.reads.includes('articles/stub-ccc1'));
});

test('readSharedArticle returns the duplicate when its winner is missing', async () => {
  const { db } = makeFakeDb({ articles: { 'loser-0001': { mergedInto: 'winner-001', title: 'L' } } });
  const shared = await readSharedArticle(db, 'loser-0001');
  assert.equal(shared?.id, 'loser-0001');
  assert.equal(shared?.data['title'], 'L');
});

test('readSharedArticle ignores a mergedInto outside the id shape or equal to its own id', async () => {
  const { db, log } = makeFakeDb({
    articles: {
      'odd-00001': { mergedInto: 'a.b', title: 'odd' },
      'self-0001': { mergedInto: 'self-0001', title: 'self' },
    },
  });

  assert.equal((await readSharedArticle(db, 'odd-00001'))?.id, 'odd-00001');
  assert.equal((await readSharedArticle(db, 'self-0001'))?.id, 'self-0001');
  assert.deepEqual(log.reads, ['articles/odd-00001', 'articles/self-0001']);
});

test('readSharedArticle returns undefined for a missing linked article', async () => {
  const { db } = makeFakeDb({});
  assert.equal(await readSharedArticle(db, 'missing-01'), undefined);
});

// ── readSharedArticles ──────────────────────────────────────────────────────

test('readSharedArticles makes two getAll rounds when a duplicate is present', async () => {
  const { db, log } = makeFakeDb({
    articles: {
      'plain-001': { title: 'P' },
      'loser-0001': { mergedInto: 'winner-001', title: 'L' },
      'winner-001': { title: 'W' },
    },
  });

  const shared = await readSharedArticles(db, ['plain-001', 'loser-0001', 'missing-01', 'plain-001']);

  assert.equal(log.getAllCalls, 2);
  assert.equal(shared.get('plain-001')?.id, 'plain-001');
  assert.equal(shared.get('loser-0001')?.id, 'winner-001');
  assert.equal(shared.get('loser-0001')?.data['title'], 'W');
  assert.equal(shared.has('missing-01'), false);
});

test('readSharedArticles makes one getAll round when no duplicate is present', async () => {
  const { db, log } = makeFakeDb({ articles: { 'plain-001': {}, 'plain-002': {} } });

  const shared = await readSharedArticles(db, ['plain-001', 'plain-002']);

  assert.equal(log.getAllCalls, 1);
  assert.deepEqual([...shared.keys()].sort(), ['plain-001', 'plain-002']);
});
