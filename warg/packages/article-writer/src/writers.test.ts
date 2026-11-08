import type { BulkWriter, DocumentReference, Transaction } from 'firebase-admin/firestore';
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { describe, expect, test } from 'vitest';
import {
  backfillSharedArticleBaseFields,
  bootstrapSharedArticle,
  buildBackfillUpsertPatch,
  buildBootstrapBackfillPatch,
  clearUserArticleCanonicalId,
  clearUserArticleCanonicalIdInBulk,
  copySharedArticleArchiveInBulk,
  enqueueUserArticle,
  markSharedArticleBackfillBegun,
  markSharedArticleMergedInBulk,
  moveUserArticleCanonicalIdInBulk,
  recordSharedArticleBackfillFailure,
  setSharedArticleDerivedStatus,
  setSharedArticleNormalizedUrlInBulk,
  setUserArticleLinkInBulk,
  settleStuckSharedArticle,
  upsertSharedArticleForBackfill,
  countSharedArticleSaveInTransaction,
  createSharedArticleInTransaction,
  linkUserArticleInTransaction,
  markSharedArticleArchiveStarted,
  markSharedArticleFailed,
  markSharedArticleProcessing,
  markUserArticleArchivalTriggered,
  recordUserArticleError,
  setUserArticleResolvedLink,
} from './index.js';

// Each write function makes exactly one Firestore call, with the method and the
// options its write kind has always used: a merge would keep fields a replace
// drops, and the readers of the documents depend on which one it is.

interface Call {
  method: string;
  target: string;
  args: unknown[];
}

function spies() {
  const calls: Call[] = [];
  const ref = {
    path: 'articles/item1234',
    set: async (...args: unknown[]) => void calls.push({ method: 'set', target: 'ref', args: args.slice(1) }),
    update: async (...args: unknown[]) => void calls.push({ method: 'update', target: 'ref', args: args.slice(1) }),
    create: async (...args: unknown[]) => void calls.push({ method: 'create', target: 'ref', args: args.slice(1) }),
  };
  const record = (method: string) => (target: unknown, ...args: unknown[]) => {
    calls.push({ method, target: target === ref ? 'tx:ref' : 'tx:other', args: args.slice(1) });
    return tx;
  };
  const tx = { create: record('create'), update: record('update'), set: record('set') };
  // A BulkWriter call keeps every argument after the target: the field-value form has no options to split off.
  const writer = {
    update: async (target: unknown, ...args: unknown[]) =>
      void calls.push({ method: 'update', target: target === ref ? 'bulk:ref' : 'bulk:other', args }),
  };
  // Boundary cast: the spies implement only the calls the writers make.
  return {
    calls,
    ref: ref as unknown as DocumentReference,
    tx: tx as unknown as Transaction,
    writer: writer as unknown as BulkWriter,
  };
}

const now = Timestamp.fromMillis(1000);
const article = { itemId: 'item1234', url: 'https://example.com/a', domain: 'example.com', pocket: {} };

const cases: Array<[string, (s: ReturnType<typeof spies>) => unknown, Omit<Call, 'args'> & { options: unknown[] }]> = [
  [
    'createSharedArticleInTransaction',
    (s) => createSharedArticleInTransaction(s.tx, s.ref, { ...article, normalizedUrl: 'n' }, now),
    { method: 'create', target: 'tx:ref', options: [] },
  ],
  [
    'countSharedArticleSaveInTransaction',
    (s) => countSharedArticleSaveInTransaction(s.tx, s.ref, now),
    { method: 'update', target: 'tx:ref', options: [] },
  ],
  [
    'markSharedArticleArchiveStarted',
    (s) => markSharedArticleArchiveStarted(s.ref, 'req-00001', now),
    { method: 'update', target: 'ref', options: [] },
  ],
  [
    'markSharedArticleFailed',
    (s) => markSharedArticleFailed(s.ref, 'boom', now),
    { method: 'update', target: 'ref', options: [] },
  ],
  [
    'bootstrapSharedArticle',
    (s) => bootstrapSharedArticle(s.ref, article, now),
    { method: 'set', target: 'ref', options: [] },
  ],
  [
    'backfillSharedArticleBaseFields',
    (s) => backfillSharedArticleBaseFields(s.ref, buildBootstrapBackfillPatch({}, article, now)),
    { method: 'set', target: 'ref', options: [{ merge: true }] },
  ],
  [
    'markSharedArticleProcessing',
    (s) => markSharedArticleProcessing(s.ref, { ...article, requestId: 'req-00001' }, now),
    { method: 'set', target: 'ref', options: [{ merge: true }] },
  ],
  [
    'linkUserArticleInTransaction',
    (s) => linkUserArticleInTransaction(s.tx, s.ref, 'shared01'),
    { method: 'update', target: 'tx:ref', options: [] },
  ],
  [
    'recordUserArticleError',
    (s) => recordUserArticleError(s.ref, 'boom', now),
    { method: 'update', target: 'ref', options: [] },
  ],
  [
    'markUserArticleArchivalTriggered',
    (s) => markUserArticleArchivalTriggered(s.ref),
    { method: 'update', target: 'ref', options: [] },
  ],
  [
    'setUserArticleResolvedLink',
    (s) => setUserArticleResolvedLink(s.ref, { resolvedId: 'shared01', archivalTriggered: false }),
    { method: 'set', target: 'ref', options: [{ merge: true }] },
  ],
  [
    'setSharedArticleDerivedStatus',
    (s) => setSharedArticleDerivedStatus(s.ref, 'complete', now),
    { method: 'set', target: 'ref', options: [{ merge: true }] },
  ],
  [
    'upsertSharedArticleForBackfill',
    (s) => upsertSharedArticleForBackfill(s.ref, buildBackfillUpsertPatch(undefined, { ...article, retryCount: 0 }, now)),
    { method: 'set', target: 'ref', options: [{ merge: true }] },
  ],
  [
    'markSharedArticleBackfillBegun',
    (s) =>
      markSharedArticleBackfillBegun(s.ref, { requestId: 'req-00001', processingStartedAt: now, updatedAt: now }),
    { method: 'set', target: 'ref', options: [{ merge: true }] },
  ],
  [
    'recordSharedArticleBackfillFailure',
    (s) =>
      recordSharedArticleBackfillFailure(s.ref, {
        failureClass: 'TRANSIENT_UPSTREAM',
        message: 'boom',
        failedAt: now,
        retryCount: 1,
        firstSeen: true,
      }),
    { method: 'set', target: 'ref', options: [{ merge: true }] },
  ],
  [
    'settleStuckSharedArticle',
    (s) => settleStuckSharedArticle(s.ref, now),
    { method: 'set', target: 'ref', options: [{ merge: true }] },
  ],
  [
    'clearUserArticleCanonicalId',
    (s) => clearUserArticleCanonicalId(s.ref, now),
    { method: 'update', target: 'ref', options: [{ lastUpdateTime: now }] },
  ],
  [
    'enqueueUserArticle',
    (s) =>
      enqueueUserArticle(s.ref, { url: 'https://example.com/a', favorite: '', status: '', timeRead: 0, resolvedId: 'item1234' }, now),
    { method: 'create', target: 'ref', options: [] },
  ],
];

const bulkCases: Array<[string, (s: ReturnType<typeof spies>) => unknown, unknown[]]> = [
  [
    'copySharedArticleArchiveInBulk',
    (s) => copySharedArticleArchiveInBulk(s.writer, s.ref, 'readability.v2', { status: 'success' }),
    [new FieldPath('archives', 'readability.v2'), { status: 'success' }],
  ],
  [
    'setSharedArticleNormalizedUrlInBulk',
    (s) => setSharedArticleNormalizedUrlInBulk(s.writer, s.ref, 'https://example.com/a'),
    ['normalizedUrl', 'https://example.com/a'],
  ],
  [
    'markSharedArticleMergedInBulk',
    (s) => markSharedArticleMergedInBulk(s.writer, s.ref, 'winner01'),
    ['mergedInto', 'winner01'],
  ],
  [
    'moveUserArticleCanonicalIdInBulk',
    (s) => moveUserArticleCanonicalIdInBulk(s.writer, s.ref, 'winner01'),
    ['canonicalId', 'winner01'],
  ],
  [
    'setUserArticleLinkInBulk',
    (s) => setUserArticleLinkInBulk(s.writer, s.ref, 'shared01', now),
    [{ canonicalId: 'shared01', resolvedId: 'shared01' }, { lastUpdateTime: now }],
  ],
  [
    'clearUserArticleCanonicalIdInBulk',
    (s) => clearUserArticleCanonicalIdInBulk(s.writer, s.ref, now),
    [{ canonicalId: FieldValue.delete() }, { lastUpdateTime: now }],
  ],
];

describe('each writer makes one call with its method, target and options', () => {
  test.each(cases)('%s', async (_name, write, expected) => {
    const s = spies();
    await write(s);
    expect(s.calls).toHaveLength(1);
    const [call] = s.calls;
    expect(call!.method).toBe(expected.method);
    expect(call!.target).toBe(expected.target);
    expect(call!.args).toEqual(expected.options);
  });
});

describe('each bulk writer queues one update with its arguments and options', () => {
  test.each(bulkCases)('%s', async (_name, write, expectedArgs) => {
    const s = spies();
    await write(s);
    expect(s.calls).toHaveLength(1);
    const [call] = s.calls;
    expect(call!.method).toBe('update');
    expect(call!.target).toBe('bulk:ref');
    expect(call!.args).toEqual(expectedArgs);
  });

  test('the archive copy names the archive key as one field path segment', async () => {
    const s = spies();
    await copySharedArticleArchiveInBulk(s.writer, s.ref, 'readability.v2', {});
    const field = s.calls[0]!.args[0];
    if (!(field instanceof FieldPath)) throw new Error('the archive copy did not name a FieldPath');
    expect(field.isEqual(new FieldPath('archives', 'readability.v2'))).toBe(true);
    expect(field.isEqual(new FieldPath('archives', 'readability', 'v2'))).toBe(false);
  });
});
