import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { Timestamp } from 'firebase-admin/firestore';
import { handleEnqueueArticle } from '../enqueue-article.js';
import { makeFakeDb, type FakeLog } from './fake-firestore.js';

// The exact user article the dashboard creates to queue a URL: path and fields.
// The save trigger and the app read it, so a change here is a change for every
// deployed reader.

const USER = 'dash-user';
const URL = 'https://www.example.com/a';

function normalise(value: unknown): unknown {
  if (value instanceof Timestamp) return '<timestamp>';
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalise(v)]));
  }
  return value;
}

const creates = (log: FakeLog) => log.creates.map((c) => ({ path: c.path, data: normalise(c.data) }));

function makeReq(body: unknown): Request {
  return { query: {}, body } as unknown as Request;
}

function makeRes(): Response & { statusCode: number } {
  const res = {
    statusCode: 200,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json() {
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number };
}

async function enqueue(body: unknown, seed: Parameters<typeof makeFakeDb>[0] = {}) {
  const fake = makeFakeDb(seed);
  const res = makeRes();
  await handleEnqueueArticle(makeReq(body), res, { db: fake.db, userId: USER });
  return { log: fake.log, status: res.statusCode };
}

test('enqueue with an item id and body fields creates the user article with them', async () => {
  const { log, status } = await enqueue({ url: URL, itemId: 'item1234', favorite: '1', status: '0', timeRead: 42 });

  assert.equal(status, 201);
  assert.deepEqual(creates(log), [
    {
      path: `users/${USER}/articles/item1234`,
      data: {
        url: URL,
        favorite: '1',
        status: '0',
        timeAdded: '<timestamp>',
        timeRead: 42,
        resolvedId: 'item1234',
        archival_triggered: false,
        queued_at: '<timestamp>',
        queued_by: 'dashboard',
      },
    },
  ]);
  assert.deepEqual(log.writes, []);
});

test('enqueue without an item id creates the user article under a new id', async () => {
  const { log } = await enqueue({ url: URL });

  assert.deepEqual(creates(log), [
    {
      path: `users/${USER}/articles/auto-id-0001`,
      data: {
        url: URL,
        favorite: '',
        status: '',
        timeAdded: '<timestamp>',
        timeRead: 0,
        resolvedId: 'auto-id-0001',
        archival_triggered: false,
        queued_at: '<timestamp>',
        queued_by: 'dashboard',
      },
    },
  ]);
  assert.deepEqual(log.writes, []);
});

test('enqueue coerces a non-string favorite and status and a non-finite timeRead', async () => {
  const { log } = await enqueue({ url: URL, itemId: 'item5678', favorite: 1, status: true, timeRead: Number.NaN });

  assert.deepEqual(creates(log), [
    {
      path: `users/${USER}/articles/item5678`,
      data: {
        url: URL,
        favorite: '',
        status: '',
        timeAdded: '<timestamp>',
        timeRead: 0,
        resolvedId: 'item5678',
        archival_triggered: false,
        queued_at: '<timestamp>',
        queued_by: 'dashboard',
      },
    },
  ]);
  assert.deepEqual(log.writes, []);
});

test('enqueue of an existing user article writes nothing', async () => {
  const { log, status } = await enqueue(
    { url: URL, itemId: 'item1234' },
    { userArticles: { item1234: { url: URL } } }
  );

  assert.equal(status, 200);
  assert.deepEqual(log.creates, []);
  assert.deepEqual(log.writes, []);
});
