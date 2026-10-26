import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { handleListArticles } from '../list-articles.js';
import { handleGetArticle } from '../get-article.js';
import { handleBootstrapArticle } from '../bootstrap-article.js';
import { handleMarkProcessing } from '../mark-processing.js';
import { makeFakeDb } from './fake-firestore.js';

// Each dashboard path that reads a shared article, run against a fake Firestore.
// The shared article must come from the server-written canonicalId (else the item
// id), with a merged duplicate followed once; the app-written resolvedId is ignored.

const USER = 'dash-user';
const ITEM = 'item1234';
const deps = (db: ReturnType<typeof makeFakeDb>['db']) => ({ db, userId: USER });

function makeReq(query: Record<string, unknown> = {}, body: unknown = {}): Request {
  return { query, body } as unknown as Request;
}

function makeRes() {
  const captured: { status?: number; body?: Record<string, unknown> } = {};
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      captured.body = body;
      return this;
    },
  } as unknown as Response;
  return { res, captured };
}

const shared = (title: string, extra: Record<string, unknown> = {}) => ({
  item_id: 'x',
  url: 'https://example.com/a',
  domain: 'example.com',
  created_at: '2026-01-01T00:00:00.000Z',
  pocket: {},
  stats: {},
  metadata: { title },
  ...extra,
});

const userArticle = (extra: Record<string, unknown>) => ({
  url: 'https://example.com/a',
  timeAdded: 1,
  ...extra,
});

/** Runs every path once on a fresh fake seeded by `seed` and returns what each did. */
async function runAll(seed: Parameters<typeof makeFakeDb>[0]) {
  const out: Record<string, { log: ReturnType<typeof makeFakeDb>['log']; body?: Record<string, unknown> }> = {};

  let fake = makeFakeDb(seed);
  let r = makeRes();
  await handleListArticles(makeReq(), r.res, deps(fake.db));
  out['list'] = { log: fake.log, body: r.captured.body };

  fake = makeFakeDb(seed);
  r = makeRes();
  await handleGetArticle(makeReq(), r.res, ITEM, deps(fake.db));
  out['get'] = { log: fake.log, body: r.captured.body };

  fake = makeFakeDb(seed);
  r = makeRes();
  await handleBootstrapArticle(makeReq(), r.res, ITEM, deps(fake.db));
  out['bootstrap'] = { log: fake.log, body: r.captured.body };

  fake = makeFakeDb(seed);
  r = makeRes();
  await handleMarkProcessing(makeReq({}, { requestId: 'req-00001' }), r.res, ITEM, deps(fake.db));
  out['mark'] = { log: fake.log, body: r.captured.body };

  return out;
}

const listTitle = (body?: Record<string, unknown>) =>
  (body?.['articles'] as Array<{ title?: string }> | undefined)?.[0]?.title;

const articleWrites = (log: ReturnType<typeof makeFakeDb>['log']) =>
  log.writes.filter((w) => w.path.startsWith('articles/')).map((w) => w.path);

test('every path reads the canonicalId shared article, never a foreign resolvedId', async () => {
  const out = await runAll({
    userArticles: { [ITEM]: userArticle({ canonicalId: 'own-share1', resolvedId: 'victim-sh1' }) },
    articles: { 'own-share1': shared('Own'), 'victim-sh1': shared('Victim') },
  });

  for (const [path, { log }] of Object.entries(out)) {
    assert.ok(log.reads.includes('articles/own-share1'), `${path} read the linked article`);
    assert.ok(!log.reads.includes('articles/victim-sh1'), `${path} read the resolvedId article`);
  }
  assert.equal(listTitle(out['list']!.body), 'Own');
  assert.equal(out['get']!.body?.['title'], 'Own');
  assert.equal(out['bootstrap']!.body?.['canonicalItemId'], 'own-share1');
  assert.deepEqual(articleWrites(out['mark']!.log), ['articles/own-share1']);
  assert.equal(out['mark']!.log.writes[0]!.data['status'], 'processing');
});

test('with no canonicalId every path reads the shared article by item id', async () => {
  const out = await runAll({
    userArticles: { [ITEM]: userArticle({ resolvedId: 'victim-sh1' }) },
    articles: { [ITEM]: shared('Self'), 'victim-sh1': shared('Victim') },
  });

  for (const [path, { log }] of Object.entries(out)) {
    assert.ok(log.reads.includes(`articles/${ITEM}`), `${path} read the item's own article`);
    assert.ok(!log.reads.includes('articles/victim-sh1'), `${path} read the resolvedId article`);
  }
  // The fake throws on any query of `articles`, so bootstrap finished without a URL lookup.
  assert.equal(out['bootstrap']!.body?.['canonicalItemId'], ITEM);
  assert.equal(out['bootstrap']!.body?.['linkedExisting'], false);
  assert.deepEqual(articleWrites(out['mark']!.log), [`articles/${ITEM}`]);
});

test('a link to a merged duplicate reads, and marks, the merge winner', async () => {
  const out = await runAll({
    userArticles: { [ITEM]: userArticle({ canonicalId: 'loser-0001' }) },
    articles: {
      'loser-0001': shared('Loser', { mergedInto: 'winner-001' }),
      'winner-001': shared('Winner'),
    },
  });

  for (const [path, { log }] of Object.entries(out)) {
    assert.ok(log.reads.includes('articles/winner-001'), `${path} read the winner`);
  }
  assert.equal(out['list']!.log.getAllCalls, 2);
  assert.equal(listTitle(out['list']!.body), 'Winner');
  assert.equal(out['get']!.body?.['title'], 'Winner');
  assert.equal(out['bootstrap']!.body?.['canonicalItemId'], 'winner-001');
  assert.deepEqual(articleWrites(out['mark']!.log), ['articles/winner-001']);
  assert.equal(out['mark']!.body?.['canonicalItemId'], 'winner-001');
});

test('the list makes two getAll rounds for a page with one duplicate and reads no marker', async () => {
  const fake = makeFakeDb({
    userArticles: {
      'item-0001': userArticle({ canonicalId: 'plain-001' }),
      'item-0002': userArticle({ canonicalId: 'loser-0001' }),
      'item-0003': userArticle({}),
    },
    articles: {
      'plain-001': shared('P'),
      'loser-0001': shared('L', { mergedInto: 'winner-001' }),
      'winner-001': shared('W'),
      'item-0003': shared('S'),
    },
  });
  const { res, captured } = makeRes();

  await handleListArticles(makeReq(), res, deps(fake.db));

  assert.equal(fake.log.getAllCalls, 2);
  assert.ok(!fake.log.reads.some((p) => p.includes('/articleMarkers/')));
  const titles = (captured.body?.['articles'] as Array<{ item_id: string; title?: string }>).map(
    (a) => `${a.item_id}:${a.title}`
  );
  assert.deepEqual(titles, ['item-0001:P', 'item-0002:W', 'item-0003:S']);
});
