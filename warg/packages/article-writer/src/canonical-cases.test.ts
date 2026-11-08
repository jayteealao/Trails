import { isDeepStrictEqual } from 'node:util';
import type { Firestore } from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, test } from 'vitest';
import {
  projectPocket,
  readCanonicalId,
  readSharedArticle,
  readSharedArticles,
  resolveCanonicalItemId,
  type Pocket,
} from './index.js';

// The cases where the three server copies of the link reader and the pocket
// projection disagreed: the dashboard (dashboard-api), the backfill
// (backfill-archiver) and the save trigger (user-triggers). Each row keeps
// what every old copy returned, the one result the module returns now, and why
// that result was chosen. A row whose old copies differ names each copy that
// changes.

type Copy = 'dashboard' | 'backfill' | 'trigger';
const COPIES: Copy[] = ['dashboard', 'backfill', 'trigger'];

interface Row<I, O> {
  name: string;
  input: I;
  old: Record<Copy, O>;
  survivor: O;
  why: string;
}

const ITEM = 'item1234';
const SHARED = 'shared-id1';
const TIME = Timestamp.fromMillis(12_000);

/** A row whose old copies differ names, in its why, every copy whose result changes. */
function assertWhyNamesChanges<I, O>(row: Row<I, O>): void {
  const olds = COPIES.map((copy) => row.old[copy]);
  if (olds.every((value) => isDeepStrictEqual(value, olds[0]))) return;
  expect(row.why.trim(), row.name).not.toBe('');
  for (const copy of COPIES) {
    if (!isDeepStrictEqual(row.old[copy], row.survivor)) {
      expect(row.why, `${row.name}: the why must name the ${copy} copy`).toContain(copy);
    }
  }
}

// ── Resolver: the shared article id a user article counts as linked to ──────
// undefined means "not linked": the dashboard and the backfill then read the
// user article's own id, and the trigger links it by URL.

const RESOLVER_CASES: Array<Row<Record<string, unknown> | undefined, string | undefined>> = [
  {
    name: 'R1 canonicalId of the id shape',
    input: { canonicalId: 'own-share1' },
    old: { dashboard: 'own-share1', backfill: 'own-share1', trigger: 'own-share1' },
    survivor: 'own-share1',
    why: 'all copies agree',
  },
  {
    name: 'R2 canonicalId blank',
    input: { canonicalId: '' },
    old: { dashboard: undefined, backfill: undefined, trigger: undefined },
    survivor: undefined,
    why: 'all copies agree',
  },
  {
    name: 'R2 canonicalId not a string',
    input: { canonicalId: 42 },
    old: { dashboard: undefined, backfill: undefined, trigger: undefined },
    survivor: undefined,
    why: 'all copies agree',
  },
  {
    name: 'R2 canonicalId absent',
    input: {},
    old: { dashboard: undefined, backfill: undefined, trigger: undefined },
    survivor: undefined,
    why: 'all copies agree',
  },
  {
    name: 'R3 canonicalId padded',
    input: { canonicalId: ' padded ' },
    old: { dashboard: undefined, backfill: undefined, trigger: ' padded ' },
    survivor: undefined,
    why:
      'the server writes only ids of the creator shape, so a value outside the reader shape is no link; ' +
      'the trigger changes: it re-links the user article instead of stopping',
  },
  {
    name: 'R4 canonicalId with a slash',
    input: { canonicalId: 'a/b' },
    old: { dashboard: undefined, backfill: undefined, trigger: 'a/b' },
    survivor: undefined,
    why:
      'as R3; the trigger changes: it read articles/a/b, which the SDK rejects, so the old trigger failed on every retry',
  },
  {
    name: 'R5 canonicalId of 41 characters',
    input: { canonicalId: 'x'.repeat(41) },
    old: { dashboard: undefined, backfill: undefined, trigger: 'x'.repeat(41) },
    survivor: undefined,
    why: 'as R3; the trigger changes: it re-links the user article instead of stopping',
  },
  {
    name: 'R6 only resolvedId',
    input: { resolvedId: 'victim-sh1' },
    old: { dashboard: undefined, backfill: undefined, trigger: undefined },
    survivor: undefined,
    why: 'all copies agree: the app can write resolvedId, so it is never a link',
  },
];

describe('the link reader', () => {
  for (const row of RESOLVER_CASES) {
    test(row.name, () => {
      assertWhyNamesChanges(row);
      expect(readCanonicalId(row.input)).toBe(row.survivor);
      expect(resolveCanonicalItemId(ITEM, row.input)).toBe(row.survivor ?? ITEM);
    });
  }

  test('no user doc is not linked', () => {
    expect(readCanonicalId(undefined)).toBeUndefined();
    expect(resolveCanonicalItemId(ITEM, undefined)).toBe(ITEM);
  });
});

// ── Merge: the winner a read of a merged duplicate moves to ─────────────────
// undefined means the linked doc itself is read.

type Articles = Record<string, Record<string, unknown>>;

/** articles/{id} through get() and getAll(), counting each. */
function fakeDb(articles: Articles) {
  const log = { reads: [] as string[], getAllCalls: 0 };
  const ref = (id: string) => ({
    id,
    async get() {
      log.reads.push(`articles/${id}`);
      return { id, exists: articles[id] !== undefined, data: () => articles[id] };
    },
  });
  const db = {
    collection: () => ({ doc: ref }),
    async getAll(...refs: Array<ReturnType<typeof ref>>) {
      log.getAllCalls += 1;
      return Promise.all(refs.map((r) => r.get()));
    },
  };
  // Boundary cast: the fake implements only the slice of Firestore the readers use.
  return { db: db as unknown as Firestore, log };
}

const MERGE_CASES: Array<Row<{ articles: Articles; linkId: string }, string | undefined>> = [
  {
    name: 'M1 mergedInto another existing id',
    input: { articles: { 'loser-0001': { mergedInto: 'winner-001' }, 'winner-001': {} }, linkId: 'loser-0001' },
    old: { dashboard: 'winner-001', backfill: 'winner-001', trigger: 'winner-001' },
    survivor: 'winner-001',
    why: 'all copies agree',
  },
  {
    name: 'M2 mergedInto its own id',
    input: { articles: { 'self-0001': { mergedInto: 'self-0001' } }, linkId: 'self-0001' },
    old: { dashboard: undefined, backfill: undefined, trigger: 'self-0001' },
    survivor: undefined,
    why:
      'a self-merge is no merge, and the merge pass never writes one; the trigger changes: it skipped a ' +
      'self-merged doc as a stub, so alone it could never be linked',
  },
  {
    name: 'M3 mergedInto outside the id shape',
    input: { articles: { 'odd-00001': { mergedInto: 'bad/id' } }, linkId: 'odd-00001' },
    old: { dashboard: undefined, backfill: undefined, trigger: 'bad/id' },
    survivor: undefined,
    why: 'as R3; the trigger changes: it treated the doc as a stub and following bad/id fails',
  },
  {
    name: 'M4 mergedInto blank',
    input: { articles: { 'blank-001': { mergedInto: '' } }, linkId: 'blank-001' },
    old: { dashboard: undefined, backfill: undefined, trigger: undefined },
    survivor: undefined,
    why: 'all copies agree',
  },
  {
    name: 'M5 the winner is missing',
    input: { articles: { 'loser-0002': { mergedInto: 'gone-00001' } }, linkId: 'loser-0002' },
    old: { dashboard: undefined, backfill: undefined, trigger: 'gone-00001' },
    survivor: undefined,
    why:
      'the readers agree: the duplicate itself is read; the trigger does not change: its candidate choice ' +
      'still follows gone-00001 and links nothing to a missing article, which is link logic, not this reader',
  },
];

describe('the merge hop', () => {
  for (const row of MERGE_CASES) {
    test(row.name, async () => {
      assertWhyNamesChanges(row);
      const { linkId, articles } = row.input;
      const moved = (id: string | undefined) => (id === linkId ? undefined : id);

      expect(moved((await readSharedArticle(fakeDb(articles).db, linkId))?.id)).toBe(row.survivor);
      const batch = await readSharedArticles(fakeDb(articles).db, [linkId]);
      expect(moved(batch.get(linkId)?.id)).toBe(row.survivor);
    });
  }

  test('readSharedArticle follows mergedInto exactly once', async () => {
    const { db, log } = fakeDb({
      'stub-aaa1': { mergedInto: 'stub-bbb1', title: 'A' },
      'stub-bbb1': { mergedInto: 'stub-ccc1', title: 'B' },
      'stub-ccc1': { title: 'C' },
    });
    expect(await readSharedArticle(db, 'stub-aaa1')).toEqual({
      linkId: 'stub-aaa1',
      id: 'stub-bbb1',
      data: { mergedInto: 'stub-ccc1', title: 'B' },
    });
    expect(log.reads).not.toContain('articles/stub-ccc1');
  });

  test('readSharedArticle returns undefined for a missing linked article', async () => {
    expect(await readSharedArticle(fakeDb({}).db, 'missing-01')).toBeUndefined();
  });

  test('readSharedArticles makes two getAll rounds when a duplicate is present', async () => {
    const { db, log } = fakeDb({
      'plain-001': { title: 'P' },
      'loser-0001': { mergedInto: 'winner-001', title: 'L' },
      'winner-001': { mergedInto: 'other-0001', title: 'W' },
    });
    const shared = await readSharedArticles(db, ['plain-001', 'loser-0001', 'missing-01', 'plain-001']);

    expect(log.getAllCalls).toBe(2);
    expect(shared.get('plain-001')?.id).toBe('plain-001');
    expect(shared.get('loser-0001')?.id).toBe('winner-001');
    expect(shared.get('loser-0001')?.data['title']).toBe('W');
    expect(shared.has('missing-01')).toBe(false);
    // The winner's own mergedInto names a missing article: one hop only, so it is read as is.
    expect(log.reads).not.toContain('articles/other-0001');
  });

  test('readSharedArticles makes one getAll round when no duplicate is present', async () => {
    const { db, log } = fakeDb({ 'plain-001': {}, 'plain-002': {} });
    const shared = await readSharedArticles(db, ['plain-001', 'plain-002']);

    expect(log.getAllCalls).toBe(1);
    expect([...shared.keys()].sort()).toEqual(['plain-001', 'plain-002']);
  });
});

// ── Pocket: the pocket map a shared article gets from its user article ──────

const pocket = (
  favorite: unknown,
  resolved_id: unknown,
  status: unknown,
  time_added: unknown,
  time_read: unknown
) => ({ favorite, resolved_id, status, time_added, time_read });

const P4_INPUT = {
  favorite: '1',
  resolvedId: 'top-r1',
  status: '0',
  timeAdded: 5,
  timeRead: 6,
  pocket: { favorite: '0', resolved_id: 'nested-r1', status: '1', time_added: 7, time_read: 8 },
};

const POCKET_CASES: Array<Row<Record<string, unknown>, Record<keyof Pocket, unknown>>> = [
  {
    name: 'P1 an app save with no resolvedId',
    input: { favorite: '1', status: '0', timeAdded: 5, timeRead: 0 },
    old: {
      dashboard: pocket('1', SHARED, '0', 5, 0),
      backfill: pocket('1', SHARED, '0', 5, 0),
      trigger: pocket('1', '', '0', 5, 0),
    },
    survivor: pocket('1', SHARED, '0', 5, 0),
    why:
      'resolved_id is never blank (the backfill and bootstrap rule); the trigger changes: a shared article it ' +
      'creates now stores its own id instead of an empty string. No reader branches on the value',
  },
  {
    name: 'P2 resolvedId empty',
    input: { resolvedId: '' },
    old: {
      dashboard: pocket('', '', '', 0, 0),
      backfill: pocket('', SHARED, '', 0, 0),
      trigger: pocket('', '', '', 0, 0),
    },
    survivor: pocket('', SHARED, '', 0, 0),
    why: 'as P1; the dashboard and the trigger change: an empty resolvedId falls back to the shared id',
  },
  {
    name: 'P2 resolvedId blank',
    input: { resolvedId: '  ' },
    old: {
      dashboard: pocket('', '  ', '', 0, 0),
      backfill: pocket('', SHARED, '', 0, 0),
      trigger: pocket('', '  ', '', 0, 0),
    },
    survivor: pocket('', SHARED, '', 0, 0),
    why: 'as P1; the dashboard and the trigger change: a blank resolvedId falls back to the shared id',
  },
  {
    name: 'P3 resolvedId set',
    input: { resolvedId: 'r1' },
    old: {
      dashboard: pocket('', 'r1', '', 0, 0),
      backfill: pocket('', 'r1', '', 0, 0),
      trigger: pocket('', 'r1', '', 0, 0),
    },
    survivor: pocket('', 'r1', '', 0, 0),
    why: 'all copies agree',
  },
  {
    name: 'P4 a nested pocket map beside the top-level fields',
    input: P4_INPUT,
    old: {
      dashboard: pocket('0', 'nested-r1', '1', 7, 8),
      backfill: pocket('1', 'top-r1', '0', 5, 6),
      trigger: pocket('1', 'top-r1', '0', 5, 6),
    },
    survivor: pocket('0', 'nested-r1', '1', 7, 8),
    why:
      'the nested map is the older record of the same fields, so reading it first keeps what a legacy document ' +
      'stored; the backfill and the trigger change',
  },
  {
    name: 'P5 timeAdded a numeric string',
    input: { timeAdded: '12' },
    old: {
      dashboard: pocket('', SHARED, '', 12, 0),
      backfill: pocket('', SHARED, '', '12', 0),
      trigger: pocket('', '', '', '12', 0),
    },
    survivor: pocket('', SHARED, '', 12, 0),
    why: 'readers declare time_added a number; the backfill and the trigger change (the trigger also as P1)',
  },
  {
    name: 'P6 timeAdded a Timestamp',
    input: { timeAdded: TIME },
    old: {
      dashboard: pocket('', SHARED, '', 12, 0),
      backfill: pocket('', SHARED, '', TIME, 0),
      trigger: pocket('', '', '', TIME, 0),
    },
    survivor: pocket('', SHARED, '', 12, 0),
    why:
      'as P5: a Timestamp becomes its seconds; a URL queued from the dashboard is stored with a Timestamp ' +
      'timeAdded, so this row is reached today; the backfill and the trigger change (the trigger also as P1)',
  },
  {
    name: 'P7 favorite a number',
    input: { favorite: 1 },
    old: {
      dashboard: pocket('', SHARED, '', 0, 0),
      backfill: pocket(1, SHARED, '', 0, 0),
      trigger: pocket(1, '', '', 0, 0),
    },
    survivor: pocket('', SHARED, '', 0, 0),
    why:
      'readers declare favorite a string and no writer stores a number; the backfill and the trigger change ' +
      '(the trigger also as P1)',
  },
  {
    name: 'P8 every field null',
    input: { favorite: null, resolvedId: null, status: null, timeAdded: null, timeRead: null },
    old: {
      dashboard: pocket('', SHARED, '', 0, 0),
      backfill: pocket('', SHARED, '', 0, 0),
      trigger: pocket('', '', '', 0, 0),
    },
    survivor: pocket('', SHARED, '', 0, 0),
    why: 'as P1 for resolved_id, the rest agree; the trigger changes',
  },
  {
    name: 'P8 every field absent',
    input: {},
    old: {
      dashboard: pocket('', SHARED, '', 0, 0),
      backfill: pocket('', SHARED, '', 0, 0),
      trigger: pocket('', '', '', 0, 0),
    },
    survivor: pocket('', SHARED, '', 0, 0),
    why: 'as P1 for resolved_id, the rest agree; the trigger changes',
  },
];

describe('the pocket projection', () => {
  for (const row of POCKET_CASES) {
    test(row.name, () => {
      assertWhyNamesChanges(row);
      expect(projectPocket(row.input, SHARED)).toStrictEqual(row.survivor);
    });
  }
});
