import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { handleBootstrapArticle } from '../bootstrap-article.js';
import { handleMarkProcessing } from '../mark-processing.js';
import { makeFakeDb, type FakeLog } from './fake-firestore.js';

// The exact documents the dashboard writes to the shared article and the user
// article: path, fields and whether the write merges or replaces. These are the
// wire format that the app and the dashboard read, so a change here is a change
// for every deployed reader.

const USER = 'dash-user';
const ITEM = 'item1234';
const URL = 'https://www.example.com/a';

function normalise(value: unknown): unknown {
  if (value instanceof Timestamp) return '<timestamp>';
  if (value instanceof FieldValue) {
    for (const n of [1, -1]) {
      if (value.isEqual(FieldValue.increment(n))) return `<increment:${n}>`;
    }
    return '<fieldvalue>';
  }
  if (Array.isArray(value)) return value.map(normalise);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalise(v)]));
  }
  return value;
}

const writes = (log: FakeLog) =>
  log.writes.map((w) => ({ path: w.path, data: normalise(w.data), merge: w.merge }));

function makeReq(body: unknown = {}): Request {
  return { query: {}, body } as unknown as Request;
}

function makeRes(): Response {
  const res = {
    status() {
      return res;
    },
    json() {
      return res;
    },
  };
  return res as unknown as Response;
}

const completeShared = () => ({
  item_id: ITEM,
  url: URL,
  domain: 'example.com',
  created_at: Timestamp.fromMillis(1000),
  status: 'pending',
  archives: {},
  pocket: { favorite: '' },
  stats: { total_saves: 1 },
});

const pocketOf = (resolvedId: string) => ({
  favorite: '',
  resolved_id: resolvedId,
  status: '',
  time_added: 1,
  time_read: 0,
});

const stats = { last_accessed: '', total_saves: 1, total_views: 0 };

async function bootstrap(seed: Parameters<typeof makeFakeDb>[0]) {
  const fake = makeFakeDb(seed);
  await handleBootstrapArticle(makeReq(), makeRes(), ITEM, { db: fake.db, userId: USER });
  return writes(fake.log);
}

test('bootstrap with no shared article replaces it whole, then merges the user link', async () => {
  const out = await bootstrap({ userArticles: { [ITEM]: { url: URL, timeAdded: 1 } } });
  assert.deepEqual(out, [
    {
      path: `articles/${ITEM}`,
      data: {
        item_id: ITEM,
        url: URL,
        domain: 'example.com',
        created_at: '<timestamp>',
        updated_at: '<timestamp>',
        status: 'pending',
        archives: {},
        pocket: pocketOf(ITEM),
        stats,
      },
      merge: false,
    },
    { path: `users/${USER}/articles/${ITEM}`, data: { resolvedId: ITEM }, merge: true },
  ]);
});

const missingFieldCases: Array<[string, unknown]> = [
  ['item_id', ITEM],
  ['url', URL],
  ['domain', 'example.com'],
  ['created_at', '<timestamp>'],
  ['pocket', pocketOf(ITEM)],
  ['stats', stats],
];

for (const [field, expected] of missingFieldCases) {
  test(`bootstrap merges only the missing ${field} and updated_at into the shared article`, async () => {
    const shared = Object.fromEntries(Object.entries(completeShared()).filter(([key]) => key !== field));
    const out = await bootstrap({
      userArticles: { [ITEM]: { url: URL, timeAdded: 1, resolvedId: ITEM } },
      articles: { [ITEM]: shared },
    });
    assert.deepEqual(out, [
      { path: `articles/${ITEM}`, data: { updated_at: '<timestamp>', [field]: expected }, merge: true },
    ]);
  });
}

test('bootstrap of a complete shared article that the user already resolves writes nothing', async () => {
  const out = await bootstrap({
    userArticles: { [ITEM]: { url: URL, timeAdded: 1, resolvedId: ITEM } },
    articles: { [ITEM]: completeShared() },
  });
  assert.deepEqual(out, []);
});

test('bootstrap of an article linked to another shared article marks the archive as triggered', async () => {
  const other = 'other-sh1';
  const out = await bootstrap({
    userArticles: { [ITEM]: { url: URL, timeAdded: 1, canonicalId: other, resolvedId: other } },
    articles: { [other]: { ...completeShared(), item_id: other } },
  });
  assert.deepEqual(out, [
    {
      path: `users/${USER}/articles/${ITEM}`,
      data: { resolvedId: other, archival_triggered: true },
      merge: true,
    },
  ]);
});

async function markProcessing(body: unknown) {
  const fake = makeFakeDb({
    userArticles: { [ITEM]: { url: URL, timeAdded: 1 } },
    articles: { [ITEM]: completeShared() },
  });
  await handleMarkProcessing(makeReq(body), makeRes(), ITEM, { db: fake.db, userId: USER });
  return writes(fake.log);
}

const markWrites = (requestId: string) => [
  {
    path: `articles/${ITEM}`,
    data: {
      item_id: ITEM,
      url: URL,
      domain: 'example.com',
      status: 'processing',
      warg_request_id: requestId,
      processing_started_at: '<timestamp>',
      updated_at: '<timestamp>',
    },
    merge: true,
  },
  {
    path: `users/${USER}/articles/${ITEM}`,
    data: { resolvedId: ITEM, archival_triggered: true },
    merge: true,
  },
];

test('mark-processing merges the request id of the body into the shared article and links the user article', async () => {
  assert.deepEqual(await markProcessing({ requestId: 'req-00001' }), markWrites('req-00001'));
});

test('mark-processing without a body request id uses the item id', async () => {
  assert.deepEqual(await markProcessing({}), markWrites(ITEM));
});
