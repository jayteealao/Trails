import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { buildPocket } from '../bootstrap-article.js';

// The dashboard bootstrap's pocket map on the cases where the server's pocket
// projections have disagreed. Each row is today's dashboard result.

const SHARED = 'shared-id1';
const pocket = (favorite: string, resolved_id: string, status: string, time_added: number, time_read: number) => ({
  favorite,
  resolved_id,
  status,
  time_added,
  time_read,
});

const ROWS: Array<{ name: string; userDoc: Record<string, unknown>; expected: ReturnType<typeof pocket> }> = [
  {
    name: 'P1 an app save with no resolvedId',
    userDoc: { favorite: '1', status: '0', timeAdded: 5, timeRead: 0 },
    expected: pocket('1', SHARED, '0', 5, 0),
  },
  { name: 'P2 resolvedId empty', userDoc: { resolvedId: '' }, expected: pocket('', '', '', 0, 0) },
  { name: 'P2 resolvedId blank', userDoc: { resolvedId: '  ' }, expected: pocket('', '  ', '', 0, 0) },
  { name: 'P3 resolvedId set', userDoc: { resolvedId: 'r1' }, expected: pocket('', 'r1', '', 0, 0) },
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
    expected: pocket('0', 'nested-r1', '1', 7, 8),
  },
  { name: 'P5 timeAdded a numeric string', userDoc: { timeAdded: '12' }, expected: pocket('', SHARED, '', 12, 0) },
  {
    name: 'P6 timeAdded a Timestamp',
    userDoc: { timeAdded: Timestamp.fromMillis(12_000) },
    expected: pocket('', SHARED, '', 12, 0),
  },
  { name: 'P7 favorite a number', userDoc: { favorite: 1 }, expected: pocket('', SHARED, '', 0, 0) },
  {
    name: 'P8 every field null',
    userDoc: { favorite: null, resolvedId: null, status: null, timeAdded: null, timeRead: null },
    expected: pocket('', SHARED, '', 0, 0),
  },
  { name: 'P8 every field absent', userDoc: {}, expected: pocket('', SHARED, '', 0, 0) },
];

for (const row of ROWS) {
  test(`buildPocket: ${row.name}`, () => {
    assert.deepEqual(buildPocket(row.userDoc, SHARED), row.expected);
  });
}
