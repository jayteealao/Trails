import type { DocumentReference, Transaction } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, test } from 'vitest';
import {
  backfillSharedArticleBaseFields,
  bootstrapSharedArticle,
  buildBootstrapBackfillPatch,
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
  };
  const record = (method: string) => (target: unknown, ...args: unknown[]) => {
    calls.push({ method, target: target === ref ? 'tx:ref' : 'tx:other', args: args.slice(1) });
    return tx;
  };
  const tx = { create: record('create'), update: record('update'), set: record('set') };
  // Boundary cast: the spies implement only the calls the writers make.
  return { calls, ref: ref as unknown as DocumentReference, tx: tx as unknown as Transaction };
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
