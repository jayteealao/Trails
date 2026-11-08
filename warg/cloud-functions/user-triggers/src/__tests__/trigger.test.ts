import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import * as firestore from 'firebase-admin/firestore';
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
