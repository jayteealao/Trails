import test from 'node:test';
import assert from 'node:assert/strict';
import { mergedTargetOf, resolveCanonicalItemId } from '../util.js';

// The dashboard's answers on the cases where the server's link readers have
// disagreed: which shared article a user article reads, and whether a shared
// article is a merged duplicate. Each row is today's dashboard result.

const ITEM = 'item1234';

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
  test(`resolveCanonicalItemId: ${row.name}`, () => {
    assert.equal(resolveCanonicalItemId(ITEM, row.userDoc), row.expected);
  });
}

const MERGE_ROWS: Array<{ name: string; id: string; data: Record<string, unknown>; expected: string | undefined }> = [
  { name: 'M1 mergedInto another id', id: 'loser-0001', data: { mergedInto: 'winner-001' }, expected: 'winner-001' },
  { name: 'M2 mergedInto its own id', id: 'self-0001', data: { mergedInto: 'self-0001' }, expected: undefined },
  { name: 'M3 mergedInto outside the id shape', id: 'odd-00001', data: { mergedInto: 'bad/id' }, expected: undefined },
  { name: 'M4 mergedInto blank', id: 'blank-001', data: { mergedInto: '' }, expected: undefined },
];

for (const row of MERGE_ROWS) {
  test(`mergedTargetOf: ${row.name}`, () => {
    assert.equal(mergedTargetOf(row.id, row.data), row.expected);
  });
}
