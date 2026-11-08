import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import * as firestore from 'firebase-admin/firestore';
import { normalizeUrl } from '@warg/url-normalizer';
import { makeRecordingDb } from './recording-firestore.js';

// Drives the deployed save trigger end to end: the event's time feeds the retry
// window, the real gateway client posts to a scripted fetch, and Firestore is
// the recording store. Event times are relative to the real clock.

process.env['PUBLIC_API_KEY'] = 'pk-test';
process.env['CF_ACCESS_CLIENT_ID'] = 'cf-id';
process.env['CF_ACCESS_CLIENT_SECRET'] = 'cf-secret';
process.env['GATEWAY_URL'] = 'https://gateway.test';

const USER = 'user0001';
const ITEM = 'item1234';
const URL = 'https://www.example.com/a?utm_source=x';
const USER_PATH = `users/${USER}/articles/${ITEM}`;
const HOUR = 60 * 60 * 1000;

const current: { store: ReturnType<typeof makeRecordingDb> } = { store: makeRecordingDb() };
mock.module('firebase-admin/firestore', {
  namedExports: { ...firestore, getFirestore: () => current.store.db },
});

const { onUserArticleSave } = await import('../index.js');

interface Post {
  url: string;
  headers: unknown;
  body: unknown;
}

const realFetch = globalThis.fetch;
let posts: Post[] = [];

function answer(responses: Array<{ status: number; body: string }>): void {
  const queue = [...responses];
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    posts.push({
      url: String(input),
      headers: init?.headers,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    });
    const next = queue.shift();
    if (!next) throw new Error('unexpected fetch');
    return new Response(next.body, { status: next.status });
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
  posts = [];
});

/** A fresh store holding the user articles (and shared articles) a test starts from. */
function seed(opts: { users?: Record<string, Record<string, unknown>>; articles?: Record<string, Record<string, unknown>> }) {
  current.store = makeRecordingDb(opts);
  return current.store;
}

type SaveEvent = Parameters<typeof onUserArticleSave.run>[0];

function event(opts: { itemId?: string; data: Record<string, unknown> | undefined; time?: string }): SaveEvent {
  const raw = {
    data: opts.data === undefined ? undefined : { data: () => opts.data },
    params: { userId: USER, itemId: opts.itemId ?? ITEM },
    time: opts.time ?? new Date().toISOString(),
  };
  // Boundary cast: the trigger reads only data(), params and time of the platform event.
  return raw as unknown as SaveEvent;
}

const deliver = (e: SaveEvent) => onUserArticleSave.run(e);

test('an event without a document resolves without a gateway call or a write', async () => {
  const store = seed({});
  answer([]);
  assert.equal(await deliver(event({ data: undefined })), null);
  assert.deepEqual(posts, []);
  assert.deepEqual(store.writes, []);
});

const saveData = { url: URL, favorite: '1', timeAdded: 5 };
const beginBody = { url: URL, request_id: ITEM, includeScreenshot: true, includePdf: true };

test('a created user article calls the gateway once with its link, records the start, and a re-delivery calls nothing', async () => {
  const store = seed({ users: { [`${USER}/articles/${ITEM}`]: saveData } });
  answer([{ status: 200, body: '{"requestId":"req-00001"}' }]);
  const e = event({ data: saveData });

  assert.equal(await deliver(e), null);
  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.url, 'https://gateway.test/begin');
  assert.deepEqual(posts[0]?.headers, {
    'Content-Type': 'application/json',
    'X-API-Key': 'pk-test',
    'CF-Access-Client-Id': 'cf-id',
    'CF-Access-Client-Secret': 'cf-secret',
  });
  assert.deepEqual(posts[0]?.body, beginBody);
  assert.equal(store.docs.get(`articles/${ITEM}`)?.['status'], 'processing');
  assert.equal(store.docs.get(`articles/${ITEM}`)?.['warg_request_id'], 'req-00001');
  assert.equal(store.docs.get(USER_PATH)?.['canonicalId'], ITEM);
  assert.equal(store.docs.get(USER_PATH)?.['archival_triggered'], true);

  const writesAfterFirst = store.writes.length;
  assert.equal(await deliver(e), null);
  assert.equal(posts.length, 1);
  assert.equal(store.writes.length, writesAfterFirst);
});

test('a save of a link that already has a shared article links to it without a gateway call', async () => {
  const store = seed({
    users: { [`${USER}/articles/${ITEM}`]: saveData },
    articles: { shared01: { url: URL, normalizedUrl: normalizeUrl(URL), created_at: firestore.Timestamp.fromMillis(1000) } },
  });
  answer([]);
  assert.equal(await deliver(event({ data: saveData })), null);
  assert.deepEqual(posts, []);
  assert.equal(store.docs.get(USER_PATH)?.['canonicalId'], 'shared01');
});

test('a save with an invalid article id is skipped and the error is noted on the user article', async () => {
  const store = seed({ users: { [`${USER}/articles/bad`]: { url: URL } } });
  answer([]);
  assert.equal(await deliver(event({ itemId: 'bad', data: { url: URL } })), null);
  assert.deepEqual(posts, []);
  assert.equal(store.docs.get(`users/${USER}/articles/bad`)?.['error'], 'Invalid article id');
});

test('a save without a link is skipped and the error is noted on the user article', async () => {
  const store = seed({ users: { [`${USER}/articles/${ITEM}`]: { title: 'x' } } });
  answer([]);
  assert.equal(await deliver(event({ data: { title: 'x' } })), null);
  assert.deepEqual(posts, []);
  assert.equal(store.docs.get(USER_PATH)?.['error'], 'Missing URL');
});
