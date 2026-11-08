import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { buildPocket, followMergedIntoOnce, resolveCanonicalFromUserDoc } from '../canonical.js';

// The backfill's answers on the cases where the server's link readers and
// pocket projections have disagreed. Each row is today's backfill result.

const ITEM = 'item1234';
const SHARED = 'shared-id1';

const RESOLVER_ROWS: Array<{ name: string; userDoc: Record<string, unknown> | undefined; expected: string }> = [
  { name: 'R1 canonicalId of the id shape', userDoc: { canonicalId: 'own-share1' }, expected: 'own-share1' },
  { name: 'R2 canonicalId blank', userDoc: { canonicalId: '' }, expected: ITEM },
  { name: 'R2 canonicalId not a string', userDoc: { canonicalId: 42 }, expected: ITEM },
  { name: 'R2 canonicalId absent', userDoc: {}, expected: ITEM },
  { name: 'R2 no user doc', userDoc: undefined, expected: ITEM },
  { name: 'R3 canonicalId padded', userDoc: { canonicalId: ' padded ' }, expected: ITEM },
  { name: 'R4 canonicalId with a slash', userDoc: { canonicalId: 'a/b' }, expected: ITEM },
  { name: 'R5 canonicalId of 41 characters', userDoc: { canonicalId: 'x'.repeat(41) }, expected: ITEM },
  { name: 'R6 only resolvedId', userDoc: { resolvedId: 'victim-sh1' }, expected: ITEM },
];

for (const row of RESOLVER_ROWS) {
  test(`resolveCanonicalFromUserDoc: ${row.name}`, () => {
    assert.equal(resolveCanonicalFromUserDoc(ITEM, row.userDoc), row.expected);
  });
}

// Fake Firestore: articles/{id} reads through getAll only.
function fakeDb(articles: Record<string, Record<string, unknown>>): Firestore {
  const db = {
    collection: () => ({ doc: (id: string) => ({ id }) }),
    async getAll(...refs: Array<{ id: string }>) {
      return refs.map(({ id }) => ({ id, exists: articles[id] !== undefined, data: () => articles[id] }));
    },
  };
  // Boundary cast: the fake implements only the slice of Firestore the helper uses.
  return db as unknown as Firestore;
}

const MERGE_ROWS: Array<{
  name: string;
  articles: Record<string, Record<string, unknown>>;
  id: string;
  expected: string | undefined;
}> = [
  {
    name: 'M1 mergedInto another existing id',
    articles: { 'loser-0001': { mergedInto: 'winner-001' }, 'winner-001': {} },
    id: 'loser-0001',
    expected: 'winner-001',
  },
  { name: 'M2 mergedInto its own id', articles: { 'self-0001': { mergedInto: 'self-0001' } }, id: 'self-0001', expected: undefined },
  { name: 'M3 mergedInto outside the id shape', articles: { 'odd-00001': { mergedInto: 'bad/id' } }, id: 'odd-00001', expected: undefined },
  { name: 'M4 mergedInto blank', articles: { 'blank-001': { mergedInto: '' } }, id: 'blank-001', expected: undefined },
  { name: 'M5 the winner is missing', articles: { 'loser-0002': { mergedInto: 'gone-00001' } }, id: 'loser-0002', expected: undefined },
];

for (const row of MERGE_ROWS) {
  test(`followMergedIntoOnce: ${row.name}`, async () => {
    const winners = await followMergedIntoOnce(fakeDb(row.articles), [row.id]);
    assert.equal(winners.get(row.id), row.expected);
  });
}

const TIME = Timestamp.fromMillis(12_000);

const POCKET_ROWS: Array<{ name: string; userDoc: Record<string, unknown>; expected: Record<string, unknown> }> = [
  {
    name: 'P1 an app save with no resolvedId',
    userDoc: { favorite: '1', status: '0', timeAdded: 5, timeRead: 0 },
    expected: { favorite: '1', resolved_id: SHARED, status: '0', time_added: 5, time_read: 0 },
  },
  {
    name: 'P2 resolvedId empty',
    userDoc: { resolvedId: '' },
    expected: { favorite: '', resolved_id: SHARED, status: '', time_added: 0, time_read: 0 },
  },
  {
    name: 'P2 resolvedId blank',
    userDoc: { resolvedId: '  ' },
    expected: { favorite: '', resolved_id: SHARED, status: '', time_added: 0, time_read: 0 },
  },
  {
    name: 'P3 resolvedId set',
    userDoc: { resolvedId: 'r1' },
    expected: { favorite: '', resolved_id: 'r1', status: '', time_added: 0, time_read: 0 },
  },
  {
    name: 'P4 a nested pocket map beside the top-level fields',
    userDoc: {
      favorite: '1',
      resolvedId: 'top-r1',
      status: '0',
      timeAdded: 5,
      timeRead: 6,
      pocket: { favorite: '0', resolved_id: 'nested-r1', status: '1', time_added: 7, time_read: 8 },
    },
    expected: { favorite: '1', resolved_id: 'top-r1', status: '0', time_added: 5, time_read: 6 },
  },
  {
    name: 'P5 timeAdded a numeric string',
    userDoc: { timeAdded: '12' },
    expected: { favorite: '', resolved_id: SHARED, status: '', time_added: '12', time_read: 0 },
  },
  {
    name: 'P6 timeAdded a Timestamp',
    userDoc: { timeAdded: TIME },
    expected: { favorite: '', resolved_id: SHARED, status: '', time_added: TIME, time_read: 0 },
  },
  {
    name: 'P7 favorite a number',
    userDoc: { favorite: 1 },
    expected: { favorite: 1, resolved_id: SHARED, status: '', time_added: 0, time_read: 0 },
  },
  {
    name: 'P8 every field null',
    userDoc: { favorite: null, resolvedId: null, status: null, timeAdded: null, timeRead: null },
    expected: { favorite: '', resolved_id: SHARED, status: '', time_added: 0, time_read: 0 },
  },
  {
    name: 'P8 every field absent',
    userDoc: {},
    expected: { favorite: '', resolved_id: SHARED, status: '', time_added: 0, time_read: 0 },
  },
];

for (const row of POCKET_ROWS) {
  test(`buildPocket: ${row.name}`, () => {
    assert.deepEqual(buildPocket(row.userDoc, SHARED), row.expected);
  });
}
