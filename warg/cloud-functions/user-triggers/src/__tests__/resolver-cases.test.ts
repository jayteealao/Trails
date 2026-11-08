import test from 'node:test';
import assert from 'node:assert/strict';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { chooseSharedCandidate, linkUserArticle } from '../link.js';
import { pocketFromSave } from '../handler.js';
import { makeRecordingDb } from './recording-firestore.js';

// The save trigger's answers on the cases where the server's link readers and
// pocket projections have disagreed. Each row is today's trigger result.

const USER = 'user0001';
const ITEM = 'item1234';
const URL = 'https://example.com/a';
const TIME = Timestamp.fromMillis(12_000);
const at = (ms: number) => Timestamp.fromMillis(ms);

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

// ── chooseSharedCandidate: which docs count as merged stubs ─────────────────

test('chooseSharedCandidate: M1 mergedInto another id is a stub to follow', () => {
  assert.deepEqual(chooseSharedCandidate([{ id: 'loser-0001', data: { mergedInto: 'winner-001' } }]), {
    followMergedInto: 'winner-001',
  });
});

test('chooseSharedCandidate: M2 mergedInto its own id is a stub', () => {
  assert.deepEqual(
    chooseSharedCandidate([
      { id: 'self-0001', data: { created_at: at(500), mergedInto: 'self-0001' } },
      { id: 'live-0001', data: { created_at: at(1000) } },
    ]),
    { id: 'live-0001' }
  );
  assert.deepEqual(chooseSharedCandidate([{ id: 'self-0001', data: { mergedInto: 'self-0001' } }]), {
    followMergedInto: 'self-0001',
  });
});

test('chooseSharedCandidate: M3 mergedInto outside the id shape is a stub to follow', () => {
  assert.deepEqual(chooseSharedCandidate([{ id: 'odd-00001', data: { mergedInto: 'bad/id' } }]), {
    followMergedInto: 'bad/id',
  });
});

test('chooseSharedCandidate: M4 mergedInto blank is live', () => {
  assert.deepEqual(chooseSharedCandidate([{ id: 'blank-001', data: { mergedInto: '' } }]), { id: 'blank-001' });
});

// ── linkUserArticle: when a user article counts as linked ───────────────────

async function link(userDoc: Record<string, unknown>) {
  const { db, writes } = makeRecordingDb({ users: { [`${USER}/articles/${ITEM}`]: { url: URL, ...userDoc } } });
  const outcome = await linkUserArticle(db, { userId: USER, itemId: ITEM, url: URL });
  return { outcome, writes };
}

test('linkUserArticle: R1 canonicalId of the id shape is linked', async () => {
  const { outcome, writes } = await link({ canonicalId: 'own-share1' });
  assert.equal(outcome.alreadyLinked, true);
  assert.equal(outcome.canonicalId, 'own-share1');
  assert.deepEqual(writes, []);
});

test('linkUserArticle: R3 a padded canonicalId counts as linked', async () => {
  const { outcome, writes } = await link({ canonicalId: ' padded ' });
  assert.equal(outcome.alreadyLinked, true);
  assert.equal(outcome.canonicalId, ' padded ');
  assert.deepEqual(writes, []);
});

test('linkUserArticle: R5 a canonicalId of 41 characters counts as linked', async () => {
  const { outcome, writes } = await link({ canonicalId: 'x'.repeat(41) });
  assert.equal(outcome.alreadyLinked, true);
  assert.equal(outcome.canonicalId, 'x'.repeat(41));
  assert.deepEqual(writes, []);
});

test('linkUserArticle: R6 only resolvedId is not linked', async () => {
  const { outcome } = await link({ resolvedId: 'victim-sh1' });
  assert.equal(outcome.alreadyLinked, false);
  assert.equal(outcome.created, true);
  assert.equal(outcome.canonicalId, ITEM);
});

test('R4 a canonicalId with a slash is not a document path the SDK can read', () => {
  const sdk = new Firestore({ projectId: 'demo' });
  assert.throws(() => sdk.collection('articles').doc('a/b'), /must point to a document/);
});
