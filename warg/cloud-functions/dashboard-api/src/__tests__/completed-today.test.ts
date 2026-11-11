import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import {
  COMPLETED_TODAY_STALE_MS,
  COMPLETED_TODAY_TTL_MS,
  handleCompletedToday,
  startOfUtcDay,
} from '../completed-today.js';
import { dashboardApi } from '../index.js';
import { makeFakeDb } from './fake-firestore.js';
import { MAX_FILTERED_ARTICLES } from '../list-articles.js';

const NOW = new Date('2026-11-08T12:00:00Z');
const TODAY = '2026-11-08T00:00:00.000Z';
const YESTERDAY = '2026-11-07T10:00:00Z';

type Entry = { status: string; created_at?: string };

/** A shared article whose four core archives succeeded at the given times. */
function complete(times: [string?, string?, string?, string?]): Record<string, unknown> {
  const [rendered, readability, markdown, singlefile] = times;
  return {
    status: 'completed',
    archives: {
      rendered: { status: 'success', created_at: rendered },
      readability: { status: 'success', created_at: readability },
      markdown: { status: 'success', created_at: markdown },
      singlefile: { status: 'success', created_at: singlefile },
    } satisfies Record<string, Entry>,
  };
}

const userDoc = (id: string) => ({ url: `https://example.com/${id}`, timeAdded: 1 });

function captureResponse() {
  const captured: { status: number; body?: unknown } = { status: 200 };
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
  } as unknown as Response;
  return { res, captured };
}

test('the day starts at UTC midnight, not at local midnight', () => {
  // 23:30 on Nov 7 at UTC-5 is 04:30 on Nov 8 in UTC.
  assert.equal(startOfUtcDay(new Date('2026-11-07T23:30:00-05:00')).toISOString(), TODAY);
});

test('only articles completed since UTC midnight are counted', async () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const { db } = makeFakeDb({
    userArticles: Object.fromEntries(ids.map((id) => [id, userDoc(id)])),
    articles: {
      // Newest core archive 5 minutes after midnight: counted.
      a: complete([YESTERDAY, YESTERDAY, YESTERDAY, '2026-11-08T00:05:00Z']),
      // Newest core archive 5 minutes before midnight: not counted.
      b: complete([YESTERDAY, YESTERDAY, '2026-11-07T23:55:00Z', YESTERDAY]),
      // Three cores yesterday, the last one today: the newest decides, counted.
      c: complete([YESTERDAY, YESTERDAY, YESTERDAY, '2026-11-08T09:00:00Z']),
      // Exactly at midnight: the boundary is inclusive, counted.
      d: complete([YESTERDAY, TODAY, YESTERDAY, YESTERDAY]),
      // Three cores succeeded today, singlefile failed: not complete, not counted.
      e: {
        status: 'failed',
        archives: {
          rendered: { status: 'success', created_at: '2026-11-08T01:00:00Z' },
          readability: { status: 'success', created_at: '2026-11-08T01:00:00Z' },
          markdown: { status: 'success', created_at: '2026-11-08T01:00:00Z' },
          singlefile: { status: 'failed', created_at: '2026-11-08T01:00:00Z' },
        },
      },
      // Complete, but no core archive time parses: not counted.
      f: complete([undefined, 'not a date', undefined, '']),
      // g has no shared doc: not counted.
      // Complete through the alias keys, today: counted.
      h: {
        status: 'completed',
        archives: {
          rendered: { status: 'success', created_at: '2026-11-08T02:00:00Z' },
          readability_json: { status: 'success', created_at: '2026-11-08T02:00:00Z' },
          readability_md: { status: 'success', created_at: '2026-11-08T03:00:00Z' },
          singlefile: { status: 'success', created_at: '2026-11-08T02:00:00Z' },
        },
      },
    },
  });

  const { res, captured } = captureResponse();
  await handleCompletedToday({} as Request, res, { db, userId: 'u', now: () => NOW, cache: new Map() });

  assert.equal(captured.status, 200);
  assert.deepEqual(captured.body, { completedToday: 4, since: TODAY, truncated: false });
});

test('a count is reused for a short while, then read again', async () => {
  const { db, log } = makeFakeDb({
    userArticles: { a: userDoc('a') },
    articles: { a: complete([TODAY, TODAY, TODAY, TODAY]) },
  });
  const cache = new Map();
  let now = NOW.getTime();
  const call = async () => {
    const { res, captured } = captureResponse();
    await handleCompletedToday({} as Request, res, { db, userId: 'u', now: () => new Date(now), cache });
    return captured.body;
  };

  // Three loads at once and one a little later read the articles once.
  const bodies = await Promise.all([call(), call(), call()]);
  now += COMPLETED_TODAY_TTL_MS - 1;
  bodies.push(await call());
  assert.equal(log.getAllCalls, 1);
  for (const body of bodies) assert.deepEqual(body, { completedToday: 1, since: TODAY, truncated: false });

  // Once the time is up, the next load gets the last count at once and reads again behind it.
  now += 1;
  assert.deepEqual(await call(), { completedToday: 1, since: TODAY, truncated: false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(log.getAllCalls, 2);

  // A new UTC day reads again at once, with the new day start.
  now = Date.parse('2026-11-09T00:00:01Z');
  assert.deepEqual(await call(), { completedToday: 0, since: '2026-11-09T00:00:00.000Z', truncated: false });
  assert.equal(log.getAllCalls, 3);
});

test('an expired count of the day is served without waiting, until it is too old', async () => {
  const { db, log } = makeFakeDb({
    userArticles: { a: userDoc('a') },
    articles: { a: complete([TODAY, TODAY, TODAY, TODAY]) },
  });
  const cache = new Map();
  let now = NOW.getTime();
  const call = async () => {
    const { res, captured } = captureResponse();
    await handleCompletedToday({} as Request, res, { db, userId: 'u', now: () => new Date(now), cache });
    return captured.body;
  };
  await call();
  assert.equal(log.getAllCalls, 1);

  // Two loads after the time is up start one read behind the served count.
  now += COMPLETED_TODAY_TTL_MS + 1;
  await Promise.all([call(), call()]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(log.getAllCalls, 2);

  // A count older than the stale window is read again before it is served.
  now += COMPLETED_TODAY_TTL_MS + COMPLETED_TODAY_STALE_MS + 1;
  await call();
  assert.equal(log.getAllCalls, 3);
});

test('a failed read is not reused', async () => {
  let reads = 0;
  const failing = {
    collection() {
      reads += 1;
      throw new Error('firestore down');
    },
  } as unknown as Firestore; // Only the method the read calls first.
  const cache = new Map();
  for (let i = 0; i < 2; i += 1) {
    const { res } = captureResponse();
    await assert.rejects(
      handleCompletedToday({} as Request, res, { db: failing, userId: 'u', now: () => NOW, cache }),
      /firestore down/
    );
  }
  assert.equal(reads, 2);
});

test('the count says when the user has more articles than it reads', async () => {
  const ids = Array.from({ length: MAX_FILTERED_ARTICLES }, (_, i) => `a${i}`);
  const { db } = makeFakeDb({
    userArticles: Object.fromEntries(ids.map((id) => [id, userDoc(id)])),
    articles: { a0: complete([TODAY, TODAY, TODAY, TODAY]) },
  });
  const { res, captured } = captureResponse();
  await handleCompletedToday({} as Request, res, { db, userId: 'u', now: () => NOW, cache: new Map() });
  assert.deepEqual(captured.body, { completedToday: 1, since: TODAY, truncated: true });
});

const KEY_NAMES = ['DASHBOARD_API_KEY', 'INTERNAL_API_KEY', 'KEY_ROTATION_DUAL_ACCEPT'];

function withEnv(values: Record<string, string>, fn: () => Promise<void>) {
  return async () => {
    const saved = new Map(KEY_NAMES.map((n) => [n, process.env[n]]));
    try {
      for (const n of KEY_NAMES) Reflect.deleteProperty(process.env, n);
      Object.assign(process.env, values);
      await fn();
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) Reflect.deleteProperty(process.env, k);
        else process.env[k] = v;
      }
    }
  };
}

/** Calls the deployed function in-process with a minimal request and response. */
async function callDashboardApi(headers: Record<string, string>) {
  const captured: { status: number; body?: unknown } = { status: 200 };
  const sent: Record<string, unknown> = {};
  const res = Object.assign(new EventEmitter(), {
    headersSent: false,
    statusCode: 200,
    setHeader(name: string, value: unknown) {
      sent[name.toLowerCase()] = value;
    },
    getHeader(name: string) {
      return sent[name.toLowerCase()];
    },
    status(code: number) {
      captured.status = code;
      return res;
    },
    json(body: unknown) {
      captured.body = body;
      res.headersSent = true;
      res.emit('finish');
      return res;
    },
    end() {
      res.headersSent = true;
      res.emit('finish');
      return res;
    },
  });
  const req = { method: 'GET', path: '/stats/completed-today', url: '/stats/completed-today', headers };
  const finished = new Promise((resolve) => res.once('finish', resolve));
  type Args = Parameters<typeof dashboardApi>;
  await dashboardApi(req as unknown as Args[0], res as unknown as Args[1]);
  await finished;
  return captured;
}

test('the count needs the API key', withEnv({ DASHBOARD_API_KEY: 'dash-k' }, async () => {
  assert.deepEqual(await callDashboardApi({}), { status: 401, body: { error: 'Unauthorized' } });
  assert.deepEqual(
    await callDashboardApi({ 'x-internal-api-key': 'wrong-k' }),
    { status: 401, body: { error: 'Unauthorized' } }
  );
}));
