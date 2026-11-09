import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { handleGetArticle } from '../get-article.js';
import { makeFakeDb } from './fake-firestore.js';

// The pocket map that GET /articles/:itemId returns, on documents shaped as
// they are stored today: the user article's own map when it has one, else the
// shared article's map, passed through unchanged.

const USER = 'dash-user';
const ITEM = 'item1234';

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

/** A user article as the app backs it up, after the server linked it. */
const appUserArticle = (canonicalId: string) => ({
  url: 'https://example.com/a',
  title: 'A',
  favorite: '1',
  status: '0',
  timeAdded: 1_700_000_000,
  timeRead: 0,
  canonicalId,
  resolvedId: canonicalId,
});

const sharedArticle = (pocket: Record<string, unknown>) => ({
  item_id: 'x',
  url: 'https://example.com/a',
  domain: 'example.com',
  status: 'complete',
  pocket,
  stats: {},
  metadata: { title: 'A' },
});

/** The pocket map the save trigger stores on a shared article it creates. */
const TRIGGER_POCKET = { favorite: '1', resolved_id: '', status: '0', time_added: 1_700_000_000, time_read: 0 };
/** The pocket map the backfill stores on a shared article it creates. */
const BACKFILL_POCKET = {
  favorite: '1',
  resolved_id: 'back-share1',
  status: '0',
  time_added: 1_700_000_000,
  time_read: 0,
};

async function pocketOf(seed: Parameters<typeof makeFakeDb>[0]) {
  const { db } = makeFakeDb(seed);
  const r = makeRes();
  await handleGetArticle({} as Request, r.res, ITEM, { db, userId: USER });
  assert.equal(r.captured.status, undefined);
  return r.captured.body?.['pocket'];
}

test('an app article linked to a shared article the trigger created reads its stored map', async () => {
  const pocket = await pocketOf({
    userArticles: { [ITEM]: appUserArticle('trig-share1') },
    articles: { 'trig-share1': sharedArticle(TRIGGER_POCKET) },
  });
  assert.deepEqual(pocket, TRIGGER_POCKET);
});

test('an app article linked to a shared article the backfill created reads its stored map', async () => {
  const pocket = await pocketOf({
    userArticles: { [ITEM]: appUserArticle('back-share1') },
    articles: { 'back-share1': sharedArticle(BACKFILL_POCKET) },
  });
  assert.deepEqual(pocket, BACKFILL_POCKET);
});

test('a user article with its own pocket map reads that map, not the shared one', async () => {
  const own = { favorite: '0', resolved_id: 'legacy-001', status: '1', time_added: 9, time_read: 10 };
  const pocket = await pocketOf({
    userArticles: { [ITEM]: { ...appUserArticle('back-share1'), pocket: own } },
    articles: { 'back-share1': sharedArticle(BACKFILL_POCKET) },
  });
  assert.deepEqual(pocket, own);
});
