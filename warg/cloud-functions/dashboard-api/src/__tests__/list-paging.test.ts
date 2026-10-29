import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { decodeListCursor, encodeListCursor, handleListArticles } from '../list-articles.js';

// An ordered, read-counting stand-in for the reads the list makes:
//   users/{uid}/articles   orderBy(field|documentId, dir)…startAfter/offset/limit, get, count
//   articles/{id}          getAll
// Every document a query or getAll returns is one read; count() reads none.

type Doc = Record<string, unknown>;
const DOC_ID = '__name__';

interface Counter {
  userDocsRead: number;
  sharedDocsRead: number;
  userQueries: number;
  countCalls: number;
  offsets: number[];
}

function makeOrderedDb(userArticles: Map<string, Doc>, shared: Map<string, Doc>) {
  const counter: Counter = { userDocsRead: 0, sharedDocsRead: 0, userQueries: 0, countCalls: 0, offsets: [] };

  interface State {
    order: Array<{ field: string; dir: 'asc' | 'desc' }>;
    after: unknown[] | null;
    offset: number;
    limit: number | null;
  }
  const keyOf = (id: string, data: Doc, field: string) => (field === DOC_ID ? id : data[field]);
  const cmp = (a: unknown[], b: unknown[], dirs: Array<'asc' | 'desc'>) => {
    for (let i = 0; i < a.length; i += 1) {
      const sign = dirs[i] === 'desc' ? -1 : 1;
      if ((a[i] as number) < (b[i] as number)) return -sign;
      if ((a[i] as number) > (b[i] as number)) return sign;
    }
    return 0;
  };
  const rows = (s: State) => {
    const dirs = s.order.map((o) => o.dir);
    let out = [...userArticles.entries()]
      .filter(([, d]) => s.order.every((o) => o.field === DOC_ID || d[o.field] !== undefined))
      .map(([id, d]) => ({ id, d, key: s.order.map((o) => keyOf(id, d, o.field)) }))
      .sort((x, y) => cmp(x.key, y.key, dirs));
    if (s.after) out = out.filter((r) => cmp(r.key.slice(0, s.after!.length), s.after!, dirs) > 0);
    out = out.slice(s.offset);
    return s.limit === null ? out : out.slice(0, s.limit);
  };
  const query = (s: State): any => ({
    orderBy: (f: unknown, dir: 'asc' | 'desc' = 'asc') =>
      query({ ...s, order: [...s.order, { field: typeof f === 'string' ? f : DOC_ID, dir }] }),
    startAfter: (...v: unknown[]) => query({ ...s, after: v }),
    offset: (n: number) => query({ ...s, offset: n }),
    limit: (n: number) => query({ ...s, limit: n }),
    get: async () => {
      const page = rows(s);
      counter.userQueries += 1;
      counter.userDocsRead += page.length;
      if (s.offset) counter.offsets.push(s.offset);
      const docs = page.map((r) => ({ id: r.id, data: () => r.d }));
      return { empty: docs.length === 0, docs };
    },
    count: () => ({
      get: async () => {
        counter.countCalls += 1;
        return { data: () => ({ count: rows({ ...s, after: null, offset: 0, limit: null }).length }) };
      },
    }),
  });

  const db = {
    collection(name: string) {
      if (name === 'articles') {
        return { doc: (id: string) => ({ id, path: `articles/${id}` }) };
      }
      return {
        doc: () => ({
          collection: () => query({ order: [], after: null, offset: 0, limit: null }),
        }),
      };
    },
    async getAll(...refs: Array<{ id: string }>) {
      counter.sharedDocsRead += refs.length;
      return refs.map((r) => ({ id: r.id, exists: shared.has(r.id), data: () => shared.get(r.id) }));
    },
  };
  // Boundary cast: the fake implements only the slice of Firestore the list uses.
  return { db: db as unknown as Firestore, counter };
}

function makeReq(query: Record<string, string>): Request {
  return { query } as unknown as Request;
}

function makeRes() {
  const captured: { status?: number; body?: Record<string, any> } = {};
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      captured.body = body;
      return this;
    },
  };
  return { res: res as unknown as Response, captured };
}

const TOTAL = 2000;

function seed() {
  const users = new Map<string, Doc>();
  const shared = new Map<string, Doc>();
  for (let i = 0; i < TOTAL; i += 1) {
    const id = `item-${String(i).padStart(5, '0')}`;
    const sharedId = `shared-${String(i).padStart(5, '0')}`;
    // Every tenth pair shares one timeAdded, so the id breaks the tie.
    const timeAdded = 1_700_000_000 + Math.floor(i / 10) * 10 + (i % 10 < 2 ? 0 : i % 10);
    users.set(id, { url: `https://e${i}.example/a`, timeAdded, canonicalId: sharedId });
    shared.set(sharedId, { metadata: { title: `T${i}` }, archives: {} });
  }
  return { users, shared };
}

async function list(db: Firestore, query: Record<string, string>) {
  const { res, captured } = makeRes();
  await handleListArticles(makeReq(query), res, { db, userId: 'dash-user' });
  return captured;
}

/** Item ids in (timeAdded desc, id desc) order, the list's order. */
function expectedOrder(users: Map<string, Doc>): string[] {
  return [...users.entries()]
    .sort(([a, x], [b, y]) => {
      const ta = x['timeAdded'] as number;
      const tb = y['timeAdded'] as number;
      if (ta !== tb) return tb - ta;
      return a < b ? 1 : a > b ? -1 : 0;
    })
    .map(([id]) => id);
}

test('AC 3: pages 1 and 2 of 2,000 articles each read one page of user docs and their shared docs', async () => {
  const { users, shared } = seed();
  const order = expectedOrder(users);

  const one = makeOrderedDb(users, shared);
  const page1 = await list(one.db, { limit: '50' });
  assert.equal(page1.status, undefined);
  const ids1 = (page1.body!['articles'] as Array<{ item_id: string }>).map((a) => a.item_id);
  assert.equal(ids1.length, 50);
  assert.deepEqual(ids1, order.slice(0, 50));
  assert.equal(one.counter.userDocsRead, 50);
  assert.equal(one.counter.userQueries, 1);
  assert.ok(one.counter.sharedDocsRead <= 50);
  assert.equal(one.counter.countCalls, 1);
  assert.equal(page1.body!['total'], TOTAL);
  assert.equal(page1.body!['hasMore'], true);
  assert.equal(typeof page1.body!['nextCursor'], 'string');

  const two = makeOrderedDb(users, shared);
  const page2 = await list(two.db, { page: '2', limit: '50', cursor: page1.body!['nextCursor'] });
  const ids2 = (page2.body!['articles'] as Array<{ item_id: string }>).map((a) => a.item_id);
  assert.deepEqual(ids2, order.slice(50, 100));
  assert.ok(!ids2.some((id) => ids1.includes(id)));
  assert.equal(two.counter.userDocsRead, 50);
  assert.ok(two.counter.sharedDocsRead <= 50);
  assert.equal(two.counter.countCalls, 1);
  assert.deepEqual(two.counter.offsets, [], 'a cursor page skips no documents');
  assert.equal(page2.body!['total'], TOTAL);
});

test('the last page has no cursor; a page without a cursor uses an offset; a bad cursor is 400', async () => {
  const { users, shared } = seed();
  const order = expectedOrder(users);

  const last = makeOrderedDb(users, shared);
  const lastPage = await list(last.db, { page: '20', limit: '100' });
  assert.deepEqual(last.counter.offsets, [1900]);
  assert.equal((lastPage.body!['articles'] as unknown[]).length, 100);
  assert.equal(lastPage.body!['hasMore'], false);

  const three = makeOrderedDb(users, shared);
  const page3 = await list(three.db, { page: '3', limit: '50' });
  assert.deepEqual(three.counter.offsets, [100]);
  assert.deepEqual(
    (page3.body!['articles'] as Array<{ item_id: string }>).map((a) => a.item_id),
    order.slice(100, 150)
  );

  const small = new Map([...users.entries()].slice(0, 30));
  const short = makeOrderedDb(small, shared);
  const shortPage = await list(short.db, { limit: '50' });
  assert.equal(shortPage.body!['nextCursor'], null);
  assert.equal(shortPage.body!['hasMore'], false);
  assert.equal(shortPage.body!['total'], 30);

  for (const bad of [
    'not-a-cursor',
    Buffer.from('{"v":{"n":1}}').toString('base64url'),
    Buffer.from('{"v":{},"id":"x"}').toString('base64url'),
    Buffer.from('{"v":{"n":1},"id":"a/b"}').toString('base64url'),
    Buffer.from('{"v":{"n":1},"id":".."}').toString('base64url'),
  ]) {
    const res = await list(makeOrderedDb(users, shared).db, { page: '2', cursor: bad });
    assert.equal(res.status, 400, bad);
    assert.deepEqual(res.body, { error: 'Invalid cursor' });
  }

  const deep = makeOrderedDb(users, shared);
  const deepPage = await list(deep.db, { page: '100000000', limit: '100' });
  assert.equal(deepPage.status, 400);
  assert.deepEqual(deep.counter.offsets, [], 'a page past the offset cap reads nothing');
});

test('a filtered list keeps the bounded read and the filtered total, with no cursor', async () => {
  const users = new Map<string, Doc>([
    ['item-a', { url: 'https://a.example/1', timeAdded: 3, canonicalId: 'shared-a' }],
    ['item-b', { url: 'https://b.example/1', timeAdded: 2, canonicalId: 'shared-b' }],
    ['item-c', { url: 'https://c.example/1', timeAdded: 1, canonicalId: 'shared-c' }],
  ]);
  const shared = new Map<string, Doc>([
    ['shared-a', { status: 'failed', archives: {} }],
    ['shared-b', { archives: { rendered: { status: 'success', gcs_path: 'x' } } }],
    ['shared-c', { status: 'failed', archives: {} }],
  ]);
  const fake = makeOrderedDb(users, shared);
  const res = await list(fake.db, { filter: 'failed', limit: '50' });
  assert.equal(fake.counter.countCalls, 0);
  assert.equal(fake.counter.userDocsRead, 3);
  assert.equal(res.body!['nextCursor'], null);
  const items = res.body!['articles'] as Array<{ item_id: string; archive_classification: string }>;
  assert.equal(res.body!['total'], items.length);
  assert.ok(items.every((a) => a.archive_classification === 'failed'));
});

test('the cursor round-trips a number, a Timestamp and a string', () => {
  for (const value of [1_700_000_123, 'Mon, 1 Jan', 0]) {
    const token = encodeListCursor(value, 'item-00001')!;
    assert.deepEqual(decodeListCursor(token), { value, id: 'item-00001' });
  }
  const ts = new Timestamp(1_700_000_000, 5);
  const decoded = decodeListCursor(encodeListCursor(ts, 'item-00002')!);
  assert.ok(decoded?.value instanceof Timestamp && decoded.value.isEqual(ts));
  assert.equal(decoded?.id, 'item-00002');
  assert.equal(encodeListCursor(undefined, 'item-00001'), null);
  assert.equal(decodeListCursor(Buffer.from(JSON.stringify({ v: { n: 1 }, id: 'x'.repeat(1501) })).toString('base64url')), null);
});

test('a deep page needs a cursor: without one it answers 400, with the cursor of the page before it answers 200', async () => {
  const { users, shared } = seed();
  const { db } = makeOrderedDb(users, shared);

  const refused = await list(db, { page: '202', limit: '50' });
  assert.equal(refused.status, 400);
  assert.equal(refused.body?.['error'], 'Page out of range; follow nextCursor instead');

  // The dashboard sends the page number with the nextCursor it got for the page before.
  const first = await list(db, { page: '1', limit: '50' });
  const cursor = first.body?.['nextCursor'];
  assert.equal(typeof cursor, 'string');
  const deep = await list(db, { page: '202', limit: '50', cursor });
  assert.equal(deep.status, undefined);
  assert.equal(deep.body?.['articles'].length, 50);
});
