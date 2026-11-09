import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import { articleStatusDerive } from '../article-status-trigger.js';
import { TRACKER_DOC_PATH, runBackfill, type BackfillDeps, type BeginPayload } from '../scheduler.js';
import { createDefaultTracker } from '../tracker.js';
import { makeFakeFirestore, type FakeFirestore, type WriteLogEntry } from './fake-firestore.js';

// The exact writes the backfill makes to the shared article and the user
// article: method, path, data (normalised) and merge flag, in order. They pin
// the wire format, so a change to how a write is made must leave these
// expectations as they are. Every id here is synthetic.

const T0 = 1_800_000_000_000;
const MIN = 60 * 1000;
const USER = 'u1';
const TS = `<ts:${T0}>`;
const ISO = '2027-01-15T08:00:00.000Z';

interface Harness {
  fake: FakeFirestore;
  deps: (extra?: Partial<BackfillDeps>) => BackfillDeps;
}

function harness(begin?: BackfillDeps['beginArchive']): Harness {
  const fake = makeFakeFirestore();
  const sent: BeginPayload[] = [];
  return {
    fake,
    deps: (extra = {}) => ({
      db: fake.db,
      userId: USER,
      batchSize: 12,
      scanPageSize: 250,
      passLabel: '1',
      beginArchive:
        begin ??
        (async (payload) => {
          sent.push(payload);
          return { requestId: `req-${sent.length}` };
        }),
      now: () => T0,
      sleep: async () => {},
      runOwner: 'test-run',
      ...extra,
    }),
  };
}

function userArticle(h: Harness, id: string, sharedId: string, extra: Record<string, unknown> = {}): void {
  h.fake.put(`users/${USER}/articles/${id}`, {
    url: `https://${id.toLowerCase()}.example/page`,
    timeUpdated: T0 - 100 * MIN,
    timeAdded: T0 - 100 * MIN,
    canonicalId: sharedId,
    ...extra,
  });
}

/** The writes to shared and user articles, in order (the tracker writes are left out). */
const articleWrites = (h: Harness): WriteLogEntry[] =>
  h.fake.writes.filter((w) => w.path.startsWith('articles/') || w.path.startsWith('users/'));

const failingBegin: BackfillDeps['beginArchive'] = async () => {
  throw new Error('Gateway begin failed: 503 upstream unavailable');
};

test('a new shared article is created, begun and linked with archival_triggered', async () => {
  const h = harness();
  userArticle(h, 'itemN001', 'sharedN001', { favorite: '1', status: '0', timeRead: 5 });

  await runBackfill(h.deps());

  assert.deepEqual(articleWrites(h), [
    {
      method: 'set',
      inTransaction: false,
      path: 'articles/sharedN001',
      data: {
        item_id: 'sharedN001',
        url: 'https://itemn001.example/page',
        domain: 'itemn001.example',
        retry_count: 0,
        updated_at: TS,
        created_at: TS,
        archives: {},
        pocket: {
          favorite: '1',
          resolved_id: 'sharedN001',
          status: '0',
          time_added: T0 - 100 * MIN,
          time_read: 5,
        },
        stats: { last_accessed: '', total_saves: 1, total_views: 0 },
      },
      merge: true,
    },
    {
      method: 'set',
      inTransaction: false,
      path: 'articles/sharedN001',
      data: { warg_request_id: 'req-1', processing_started_at: TS, updated_at: TS, error: '<delete>' },
      merge: true,
    },
    {
      method: 'set',
      inTransaction: false,
      path: `users/${USER}/articles/itemN001`,
      data: { resolvedId: 'sharedN001', archival_triggered: true },
      merge: true,
    },
  ]);
});

test('a first failed begin of an existing article fills only the missing fields and records first_seen_at', async () => {
  const h = harness(failingBegin);
  userArticle(h, 'itemF001', 'sharedF001');
  h.fake.put('articles/sharedF001', {
    item_id: 'sharedF001',
    url: 'https://itemf001.example/page',
    status: 'failed',
    retry_count: 0,
    created_at: Timestamp.fromMillis(T0 - 200 * MIN),
  });

  await runBackfill(h.deps());

  assert.deepEqual(articleWrites(h), [
    {
      method: 'set',
      inTransaction: false,
      path: 'articles/sharedF001',
      data: {
        item_id: 'sharedF001',
        url: 'https://itemf001.example/page',
        domain: 'itemf001.example',
        retry_count: 1,
        updated_at: TS,
        pocket: {
          favorite: '',
          resolved_id: 'sharedF001',
          status: '',
          time_added: T0 - 100 * MIN,
          time_read: 0,
        },
        stats: { last_accessed: '', total_saves: 1, total_views: 0 },
      },
      merge: true,
    },
    {
      method: 'set',
      inTransaction: false,
      path: 'articles/sharedF001',
      data: {
        archives: {
          gateway_begin: {
            status: 'failed',
            error: 'Gateway begin failed: 503 upstream unavailable',
            created_at: ISO,
          },
        },
        failure: {
          class: 'TRANSIENT_UPSTREAM',
          last_seen_at: TS,
          count: '<increment:1>',
          last_error_message: 'Gateway begin failed: 503 upstream unavailable',
          first_seen_at: TS,
        },
        error: 'Gateway begin failed: 503 upstream unavailable',
        failed_at: TS,
        retry_count: 1,
        updated_at: TS,
      },
      merge: true,
    },
    {
      method: 'set',
      inTransaction: false,
      path: `users/${USER}/articles/itemF001`,
      data: { resolvedId: 'sharedF001' },
      merge: true,
    },
  ]);
});

test('a second failed begin keeps the first first_seen_at out of the patch', async () => {
  const h = harness(failingBegin);
  userArticle(h, 'itemG001', 'sharedG001');
  const earlier = Timestamp.fromMillis(T0 - 300 * MIN);
  h.fake.put('articles/sharedG001', {
    item_id: 'sharedG001',
    url: 'https://itemg001.example/page',
    domain: 'itemg001.example',
    status: 'failed',
    retry_count: 1,
    created_at: earlier,
    pocket: { favorite: '', resolved_id: 'sharedG001', status: '', time_added: 0, time_read: 0 },
    stats: { last_accessed: '', total_saves: 1, total_views: 0 },
    failure: {
      class: 'TRANSIENT_UPSTREAM',
      first_seen_at: earlier,
      last_seen_at: earlier,
      count: 1,
      last_error_message: 'Gateway begin failed: 503 upstream unavailable',
    },
  });

  await runBackfill(h.deps());

  assert.deepEqual(articleWrites(h), [
    {
      method: 'set',
      inTransaction: false,
      path: 'articles/sharedG001',
      data: {
        item_id: 'sharedG001',
        url: 'https://itemg001.example/page',
        domain: 'itemg001.example',
        retry_count: 2,
        updated_at: TS,
      },
      merge: true,
    },
    {
      method: 'set',
      inTransaction: false,
      path: 'articles/sharedG001',
      data: {
        archives: {
          gateway_begin: {
            status: 'failed',
            error: 'Gateway begin failed: 503 upstream unavailable',
            created_at: ISO,
          },
        },
        failure: {
          class: 'TRANSIENT_UPSTREAM',
          last_seen_at: TS,
          count: '<increment:1>',
          last_error_message: 'Gateway begin failed: 503 upstream unavailable',
        },
        error: 'Gateway begin failed: 503 upstream unavailable',
        failed_at: TS,
        retry_count: 2,
        updated_at: TS,
      },
      merge: true,
    },
    {
      method: 'set',
      inTransaction: false,
      path: `users/${USER}/articles/itemG001`,
      data: { resolvedId: 'sharedG001' },
      merge: true,
    },
  ]);
});

test('an article that is already complete only links the user article, with archival_triggered', async () => {
  const h = harness();
  userArticle(h, 'itemC001', 'sharedC001');
  h.fake.put('articles/sharedC001', {
    item_id: 'sharedC001',
    url: 'https://itemc001.example/page',
    archives: { rendered: { status: 'success' } },
  });

  await runBackfill(h.deps());

  assert.deepEqual(articleWrites(h), [
    {
      method: 'set',
      inTransaction: false,
      path: `users/${USER}/articles/itemC001`,
      data: { resolvedId: 'sharedC001', archival_triggered: true },
      merge: true,
    },
  ]);
});

test('a batch item stuck past the timeout gets a workflow_settlement entry', async () => {
  const h = harness();
  h.fake.put(TRACKER_DOC_PATH, {
    ...createDefaultTracker(Timestamp.fromMillis(T0 - 60 * MIN)),
    pass_label: '1',
    pass_started_at: Timestamp.fromMillis(T0 - 120 * MIN),
    batch: [
      {
        item_id: 'sharedS001',
        url: 'https://items001.example/page',
        domain: 'items001.example',
        sent_at: Timestamp.fromMillis(T0 - 60 * MIN),
        retry_count: 0,
      },
    ],
    batch_started_at: Timestamp.fromMillis(T0 - 60 * MIN),
    batch_number: 1,
  } as unknown as Record<string, unknown>);
  h.fake.put('articles/sharedS001', {
    item_id: 'sharedS001',
    url: 'https://items001.example/page',
    status: 'processing',
    processing_started_at: Timestamp.fromMillis(T0 - 60 * MIN),
  });

  await runBackfill(h.deps());

  assert.deepEqual(articleWrites(h), [
    {
      method: 'set',
      inTransaction: false,
      path: 'articles/sharedS001',
      data: {
        archives: {
          workflow_settlement: {
            status: 'stuck',
            error: 'Stuck: no completion after 30 minutes',
            created_at: ISO,
          },
        },
        error: 'Stuck: no completion after 30 minutes',
        failed_at: TS,
        updated_at: TS,
      },
      merge: true,
    },
  ]);
});

// The status trigger stamps status_updated_at with the wall clock.
const withWallClock = (writes: WriteLogEntry[]): WriteLogEntry[] =>
  writes.map((w) => {
    const data = w.data as Record<string, unknown>;
    const stamp = data['status_updated_at'];
    return typeof stamp === 'string' && /^<ts:\d+>$/.test(stamp)
      ? { ...w, data: { ...data, status_updated_at: '<timestamp>' } }
      : w;
  });

async function runStatusTrigger(fake: FakeFirestore, path: string): Promise<void> {
  const after = await fake.db.doc(path).get();
  // Boundary cast: the trigger reads only event.data.after (exists, data(), ref).
  const event = { data: { before: after, after } } as unknown as Parameters<typeof articleStatusDerive.run>[0];
  await articleStatusDerive.run(event);
}

test('the status trigger merge-sets the derived status and its time when it differs', async () => {
  const fake = makeFakeFirestore();
  fake.put('articles/sharedT001', {
    url: 'https://itemt001.example/page',
    status: 'pending',
    archives: { rendered: { status: 'success' } },
  });

  await runStatusTrigger(fake, 'articles/sharedT001');

  assert.deepEqual(withWallClock(fake.writes), [
    {
      method: 'set',
      inTransaction: false,
      path: 'articles/sharedT001',
      data: { status: 'complete', status_updated_at: '<timestamp>' },
      merge: true,
    },
  ]);
});

test('the status trigger writes nothing when the status is already the derived one', async () => {
  const fake = makeFakeFirestore();
  fake.put('articles/sharedT002', {
    url: 'https://itemt002.example/page',
    status: 'complete',
    archives: { rendered: { status: 'success' } },
  });

  await runStatusTrigger(fake, 'articles/sharedT002');

  assert.deepEqual(fake.writes, []);
});

test('the status trigger writes nothing for a deleted article', async () => {
  const fake = makeFakeFirestore();

  await runStatusTrigger(fake, 'articles/sharedT003');

  assert.deepEqual(fake.writes, []);
});
