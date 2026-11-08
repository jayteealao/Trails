import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { normalizeUrl } from '@warg/url-normalizer';
import { handleUserArticleCreated, type BeginArchive } from '../handler.js';
import { makeRecordingDb, type RecordedWrite } from './recording-firestore.js';

// The exact writes of the save trigger, in order: method, transaction or not,
// path, fields and merge flag. These are the wire format of the shared article,
// the user article and the marker that the app and the dashboard read, so a
// change here is a change for every deployed reader.

const USER = 'user0001';
const ITEM = 'item1234';
const URL = 'https://www.example.com/a?utm_source=x';
const USER_PATH = `users/${USER}/articles/${ITEM}`;

const okArchive: BeginArchive = async () => ({ requestId: 'req-00001' });
const failingArchive: BeginArchive = async () => {
  throw new Error('gateway down');
};

async function run(opts: {
  itemId?: string;
  data: Record<string, unknown>;
  userDoc?: Record<string, unknown>;
  articles?: Record<string, Record<string, unknown>>;
  beginArchive?: BeginArchive;
  eventTimeMs?: number;
}) {
  const itemId = opts.itemId ?? ITEM;
  const { db, writes } = makeRecordingDb({
    articles: opts.articles,
    users: { [`${USER}/articles/${itemId}`]: opts.userDoc ?? opts.data },
  });
  let archiveCalls = 0;
  const beginArchive: BeginArchive = (payload) => {
    archiveCalls += 1;
    return (opts.beginArchive ?? okArchive)(payload);
  };
  const result = handleUserArticleCreated(
    { db, userId: USER, itemId, data: opts.data, eventTimeMs: opts.eventTimeMs },
    { beginArchive, nowMs: () => 10_000_000 }
  );
  return { result, writes, archiveCalls: () => archiveCalls };
}

const tx = (method: RecordedWrite['method'], path: string, data: unknown): RecordedWrite => ({
  method,
  inTransaction: true,
  path,
  data,
  merge: false,
});
const direct = (path: string, data: unknown): RecordedWrite => ({
  method: 'update',
  inTransaction: false,
  path,
  data,
  merge: false,
});

const marker = (sharedId: string) =>
  tx('set', `users/${USER}/articleMarkers/${sharedId}`, {
    key: sharedId,
    itemId: ITEM,
    createdAt: '<fieldvalue>',
    source: 'trigger',
  });
const link = (sharedId: string) => tx('update', USER_PATH, { canonicalId: sharedId, resolvedId: sharedId });

const createWrites = () => [
  tx('create', `articles/${ITEM}`, {
    item_id: ITEM,
    url: URL,
    normalizedUrl: normalizeUrl(URL),
    domain: 'example.com',
    created_at: '<timestamp>',
    status: 'pending',
    archives: {},
    // resolved_id is the shared article's own id, never blank (it was '' before the one pocket projection).
    pocket: { favorite: '1', resolved_id: ITEM, status: '', time_added: 5, time_read: 0 },
    stats: { last_accessed: '', total_saves: 1, total_views: 0 },
  }),
  marker(ITEM),
  link(ITEM),
];

const saveData = { url: URL, favorite: '1', timeAdded: 5 };

test('a save with no URL records the error on the user article', async () => {
  const r = await run({ data: { title: 'x' } });
  assert.equal(await r.result, 'missing-url');
  assert.deepEqual(r.writes, [direct(USER_PATH, { error: 'Missing URL', error_at: '<timestamp>' })]);
});

test('a save with an invalid id records the error on the user article', async () => {
  const r = await run({ itemId: 'bad', data: { url: URL } });
  assert.equal(await r.result, 'invalid-id');
  assert.deepEqual(r.writes, [
    direct(`users/${USER}/articles/bad`, { error: 'Invalid article id', error_at: '<timestamp>' }),
  ]);
});

test('a first save creates the shared article, links it, then marks the archive started', async () => {
  const r = await run({ data: saveData });
  assert.equal(await r.result, 'created');
  assert.equal(r.archiveCalls(), 1);
  assert.deepEqual(r.writes, [
    ...createWrites(),
    direct(`articles/${ITEM}`, {
      warg_request_id: 'req-00001',
      status: 'processing',
      processing_started_at: '<timestamp>',
    }),
    direct(USER_PATH, { archival_triggered: true }),
  ]);
});

test('a save of a URL that has a shared article counts the save and links to it', async () => {
  const r = await run({
    data: saveData,
    articles: {
      shared01: { url: URL, normalizedUrl: normalizeUrl(URL), created_at: Timestamp.fromMillis(1000) },
    },
  });
  assert.equal(await r.result, 'linked');
  assert.equal(r.archiveCalls(), 0);
  assert.deepEqual(r.writes, [
    tx('update', 'articles/shared01', {
      'stats.total_saves': '<increment:1>',
      'stats.last_saved_at': '<timestamp>',
    }),
    marker('shared01'),
    link('shared01'),
  ]);
});

test('a save that is already linked writes nothing', async () => {
  const r = await run({
    data: saveData,
    userDoc: { ...saveData, canonicalId: 'shared01' },
    articles: { shared01: { url: URL, status: 'processing', warg_request_id: 'req-0' } },
  });
  assert.equal(await r.result, 'already-linked');
  assert.deepEqual(r.writes, []);
});

test('a save whose own shared id holds another URL records the conflict on the user article', async () => {
  const r = await run({
    data: saveData,
    articles: { [ITEM]: { url: 'https://other.example.com/x' } },
  });
  assert.equal(await r.result, 'conflict');
  assert.deepEqual(r.writes, [
    direct(USER_PATH, { error: 'Shared article id conflict', error_at: '<timestamp>' }),
  ]);
});

test('an archive start that fails outside the retry window marks the pending shared article failed', async () => {
  const r = await run({ data: saveData, beginArchive: failingArchive });
  assert.equal(await r.result, 'error');
  assert.deepEqual(r.writes, [
    ...createWrites(),
    direct(`articles/${ITEM}`, { status: 'failed', error: 'gateway down', failed_at: '<timestamp>' }),
    direct(USER_PATH, { error: 'gateway down', error_at: '<timestamp>' }),
  ]);
});

test('an archive start that fails inside the retry window throws and records no failure', async () => {
  const r = await run({ data: saveData, beginArchive: failingArchive, eventTimeMs: 10_000_000 });
  await assert.rejects(r.result, /gateway down/);
  assert.deepEqual(r.writes, createWrites());
});
