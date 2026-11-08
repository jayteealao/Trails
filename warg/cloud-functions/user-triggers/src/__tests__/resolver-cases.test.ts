import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { pocketFromSave } from '../handler.js';

// The save trigger's answers on the cases where the server's pocket projections
// have disagreed. Each row is today's trigger result.

const TIME = Timestamp.fromMillis(12_000);

// ── pocketFromSave ──────────────────────────────────────────────────────────

const POCKET_ROWS: Array<{ name: string; data: Record<string, unknown>; expected: Record<string, unknown> }> = [
  {
    name: 'P1 an app save with no resolvedId',
    data: { favorite: '1', status: '0', timeAdded: 5, timeRead: 0 },
    expected: { favorite: '1', resolved_id: '', status: '0', time_added: 5, time_read: 0 },
  },
  {
    name: 'P2 resolvedId empty',
    data: { resolvedId: '' },
    expected: { favorite: '', resolved_id: '', status: '', time_added: 0, time_read: 0 },
  },
  {
    name: 'P2 resolvedId blank',
    data: { resolvedId: '  ' },
    expected: { favorite: '', resolved_id: '  ', status: '', time_added: 0, time_read: 0 },
  },
  {
    name: 'P3 resolvedId set',
    data: { resolvedId: 'r1' },
    expected: { favorite: '', resolved_id: 'r1', status: '', time_added: 0, time_read: 0 },
  },
  {
    name: 'P4 a nested pocket map beside the top-level fields',
    data: {
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
    data: { timeAdded: '12' },
    expected: { favorite: '', resolved_id: '', status: '', time_added: '12', time_read: 0 },
  },
  {
    name: 'P6 timeAdded a Timestamp',
    data: { timeAdded: TIME },
    expected: { favorite: '', resolved_id: '', status: '', time_added: TIME, time_read: 0 },
  },
  {
    name: 'P7 favorite a number',
    data: { favorite: 1 },
    expected: { favorite: 1, resolved_id: '', status: '', time_added: 0, time_read: 0 },
  },
  {
    name: 'P8 every field null',
    data: { favorite: null, resolvedId: null, status: null, timeAdded: null, timeRead: null },
    expected: { favorite: '', resolved_id: '', status: '', time_added: 0, time_read: 0 },
  },
  {
    name: 'P8 every field absent',
    data: {},
    expected: { favorite: '', resolved_id: '', status: '', time_added: 0, time_read: 0 },
  },
];

for (const row of POCKET_ROWS) {
  test(`pocketFromSave: ${row.name}`, () => {
    assert.deepEqual(pocketFromSave(row.data), row.expected);
  });
}
