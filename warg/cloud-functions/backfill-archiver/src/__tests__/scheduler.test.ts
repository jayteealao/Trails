import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import {
  CHANGE_MARKER_MARGIN_MS,
  RETRY_DELAY_MS,
  RETRY_QUEUE_MAX,
  TRACKER_DOC_PATH,
  runBackfill,
  type BackfillDeps,
  type BeginPayload,
} from '../scheduler.js';
import { createDefaultTracker, enqueueRetry } from '../tracker.js';
import { makeFakeFirestore, type FakeFirestore } from './fake-firestore.js';

// Every id here is synthetic. The run is driven with a fake clock, a no-op
// sleep and a begin stub that records each /begin payload.

const T0 = 1_800_000_000_000;
const MIN = 60 * 1000;
const USER = 'u1';

interface Harness {
  fake: FakeFirestore;
  clock: { t: number };
  sent: BeginPayload[];
  deps: (extra?: Partial<BackfillDeps>) => BackfillDeps;
  tracker: () => Record<string, any>;
}

function harness(): Harness {
  const fake = makeFakeFirestore();
  const clock = { t: T0 };
  const sent: BeginPayload[] = [];
  return {
    fake,
    clock,
    sent,
    deps: (extra = {}) => ({
      db: fake.db,
      userId: USER,
      batchSize: 12,
      scanPageSize: 250,
      passLabel: '1',
      beginArchive: async (payload) => {
        sent.push(payload);
        return { requestId: `req-${sent.length}` };
      },
      now: () => clock.t,
      sleep: async () => {},
      runOwner: 'test-run',
      ...extra,
    }),
    tracker: () => fake.read(TRACKER_DOC_PATH) as Record<string, any>,
  };
}

/** A tracker whose full pass is done, with the given marker and retry list. */
function seedCompletedPass(
  h: Harness,
  marker: { time_updated: number; item_id: string },
  extra: Record<string, unknown> = {}
): void {
  const tracker = createDefaultTracker(Timestamp.fromMillis(T0 - 60 * MIN));
  h.fake.put(TRACKER_DOC_PATH, {
    ...tracker,
    pass_label: '1',
    pass_started_at: Timestamp.fromMillis(T0 - 120 * MIN),
    pass_completed_at: Timestamp.fromMillis(T0 - 90 * MIN),
    change_marker: marker,
    ...extra,
  } as unknown as Record<string, unknown>);
}

function userArticle(
  h: Harness,
  id: string,
  fields: { timeUpdated: number; canonicalId?: string; host?: string }
): void {
  h.fake.put(`users/${USER}/articles/${id}`, {
    url: `https://${fields.host ?? id.toLowerCase()}.example/page`,
    timeUpdated: fields.timeUpdated,
    timeAdded: fields.timeUpdated,
    ...(fields.canonicalId ? { canonicalId: fields.canonicalId } : {}),
  });
}

/** Marks every shared article of the tracker's open batch as archived. */
function settleBatch(h: Harness): void {
  for (const entry of h.tracker()['batch'] as Array<{ item_id: string }>) {
    const path = `articles/${entry.item_id}`;
    h.fake.put(path, {
      ...(h.fake.read(path) ?? {}),
      archives: { rendered: { status: 'success' } },
    });
  }
}

const queries = (h: Harness) =>
  h.fake.log.filter((e): e is Extract<typeof e, { kind: 'query' }> => e.kind === 'query');

test('AC 1: an idle run after a full pass reads only the tracker and one change query', async () => {
  const h = harness();
  seedCompletedPass(h, { time_updated: T0 - 30 * MIN, item_id: 'itemA0030' });
  for (let i = 1; i <= 30; i += 1) {
    const id = `itemA${String(i).padStart(4, '0')}`;
    userArticle(h, id, { timeUpdated: T0 - 60 * MIN + i, canonicalId: `sharedA${String(i).padStart(3, '0')}` });
  }

  await runBackfill(h.deps());

  const docReads = h.fake.log.filter((e) => e.kind === 'doc');
  assert.ok(docReads.length > 0);
  assert.deepEqual([...new Set(docReads.map((e) => e.path))], [TRACKER_DOC_PATH]);
  const q = queries(h);
  assert.equal(q.length, 1);
  assert.equal(q[0]!.path, `users/${USER}/articles`);
  assert.deepEqual(q[0]!.filters.map(([field, op]) => `${field} ${op}`), ['timeUpdated >=']);
  assert.equal(q[0]!.docsReturned, 0);
  assert.ok(h.fake.log.every((e) => !e.path.startsWith('articles')), 'no shared-article read and no per-URL query');
  assert.equal(h.fake.log.filter((e) => e.kind === 'count').length, 0);
  assert.equal(h.sent.length, 0);
  assert.equal(h.tracker()['last_run_result'], 'idle');
});

test('AC 2: two changed articles are sent and the marker moves past them', async () => {
  const h = harness();
  seedCompletedPass(h, { time_updated: T0 - 30 * MIN, item_id: 'itemA0001' });
  userArticle(h, 'itemA0001', { timeUpdated: T0 - 30 * MIN, canonicalId: 'sharedA001' });
  userArticle(h, 'itemB0001', { timeUpdated: T0 - 5 * MIN, canonicalId: 'sharedB001' });
  userArticle(h, 'itemB0002', { timeUpdated: T0 - 4 * MIN, canonicalId: 'sharedB002' });
  h.fake.put('articles/sharedB002', {
    url: 'https://itemb0002.example/page',
    status: 'failed',
    retry_count: 0,
  });

  await runBackfill(h.deps());

  assert.deepEqual(h.sent.map((p) => p.request_id), ['sharedB001', 'sharedB002']);
  assert.deepEqual(h.tracker()['change_marker'], { time_updated: T0 - 4 * MIN, item_id: 'itemB0002' });
  assert.equal(queries(h).filter((q) => q.path === 'articles').length, 0, 'no per-URL query');
  assert.equal(h.fake.read('articles/sharedB002')!['retry_count'], 1);

  // The next run settles the batch; the one after it is idle again.
  settleBatch(h);
  h.clock.t += 11 * MIN;
  await runBackfill(h.deps());
  assert.equal(h.sent.length, 2);

  h.fake.log.length = 0;
  h.clock.t += 11 * MIN;
  await runBackfill(h.deps());
  assert.equal(h.sent.length, 2);
  assert.deepEqual(
    [...new Set(h.fake.log.filter((e) => e.kind === 'doc').map((e) => e.path))],
    [TRACKER_DOC_PATH]
  );
  assert.equal(queries(h).length, 1);
});

test('full pass pages without wrapping, then sets the change marker; a new label starts over', async () => {
  const h = harness();
  for (let i = 1; i <= 5; i += 1) {
    userArticle(h, `item000${i}`, { timeUpdated: T0 - 100 * MIN, canonicalId: `shared00${i}` });
  }
  const deps = (extra: Partial<BackfillDeps> = {}) =>
    h.deps({ batchSize: 2, scanPageSize: 2, ...extra });

  for (let run = 0; run < 3; run += 1) {
    await runBackfill(deps());
    settleBatch(h);
    h.clock.t += 11 * MIN;
  }

  const pages = queries(h).map((q) => q.ids);
  assert.deepEqual(pages, [
    ['item0001', 'item0002'],
    ['item0003', 'item0004'],
    ['item0005'],
  ]);
  assert.deepEqual(h.sent.map((p) => p.request_id), [
    'shared001',
    'shared002',
    'shared003',
    'shared004',
    'shared005',
  ]);
  const tracker = h.tracker();
  assert.ok(tracker['pass_completed_at'] instanceof Timestamp);
  assert.equal(tracker['pass_started_at'].toMillis(), T0);
  assert.deepEqual(tracker['change_marker'], {
    time_updated: T0 - CHANGE_MARKER_MARGIN_MS,
    item_id: '',
  });
  assert.equal(tracker['scan_cursor'], null);

  // A further run is a change scan, not a page from the start.
  h.fake.log.length = 0;
  await runBackfill(deps());
  assert.equal(queries(h).length, 1);
  assert.deepEqual(queries(h)[0]!.filters.map(([field]) => field), ['timeUpdated']);

  // A new pass label starts one new full pass from the first page.
  h.fake.log.length = 0;
  h.clock.t += 11 * MIN;
  await runBackfill(deps({ passLabel: '2' }));
  assert.deepEqual(queries(h)[0]!.ids, ['item0001', 'item0002']);
  assert.equal(h.tracker()['pass_label'], '2');
  assert.equal(h.tracker()['pass_completed_at'], null);
  assert.equal(h.sent.length, 5, 'archived articles are not sent again');
});

test('cutoff: eligible articles beyond one batch stay ahead of the cursor and the marker', async () => {
  const h = harness();
  for (let i = 1; i <= 4; i += 1) {
    userArticle(h, `item000${i}`, { timeUpdated: T0 - 100 * MIN, canonicalId: `shared00${i}` });
  }
  const deps = () => h.deps({ batchSize: 2, scanPageSize: 10 });

  await runBackfill(deps());
  assert.deepEqual(h.sent.map((p) => p.request_id), ['shared001', 'shared002']);
  assert.equal(h.tracker()['scan_cursor'], 'item0002');
  assert.equal(h.tracker()['pass_completed_at'], null);

  settleBatch(h);
  h.clock.t += 11 * MIN;
  await runBackfill(deps());
  assert.deepEqual(h.sent.map((p) => p.request_id), ['shared001', 'shared002', 'shared003', 'shared004']);
  assert.ok(h.tracker()['pass_completed_at'] instanceof Timestamp);

  // The same rule holds for the change scan's marker.
  const c = harness();
  seedCompletedPass(c, { time_updated: T0 - 30 * MIN, item_id: '' });
  for (let i = 1; i <= 4; i += 1) {
    userArticle(c, `itemC000${i}`, { timeUpdated: T0 - 10 * MIN + i, canonicalId: `sharedC00${i}` });
  }
  await runBackfill(c.deps({ batchSize: 2 }));
  assert.deepEqual(c.sent.map((p) => p.request_id), ['sharedC001', 'sharedC002']);
  assert.deepEqual(c.tracker()['change_marker'], { time_updated: T0 - 10 * MIN + 2, item_id: 'itemC0002' });

  settleBatch(c);
  c.clock.t += 11 * MIN;
  await runBackfill(c.deps({ batchSize: 2 }));
  assert.deepEqual(c.sent.map((p) => p.request_id), ['sharedC001', 'sharedC002', 'sharedC003', 'sharedC004']);
  assert.deepEqual(c.tracker()['change_marker'], { time_updated: T0 - 10 * MIN + 4, item_id: 'itemC0004' });
});

test('retry list: a failed batch entry is queued and re-sent later without a rescan', async () => {
  const h = harness();
  seedCompletedPass(h, { time_updated: T0 - 30 * MIN, item_id: '' }, {
    batch: [
      {
        item_id: 'sharedR001',
        url: 'https://r1.example/page',
        domain: 'r1.example',
        sent_at: Timestamp.fromMillis(T0 - 20 * MIN),
        retry_count: 0,
      },
    ],
    batch_started_at: Timestamp.fromMillis(T0 - 20 * MIN),
  });
  h.fake.put('articles/sharedR001', { url: 'https://r1.example/page', status: 'failed', retry_count: 0 });

  await runBackfill(h.deps());
  const queue = h.tracker()['retry_queue'] as Array<Record<string, any>>;
  assert.equal(queue.length, 1);
  assert.equal(queue[0]!['item_id'], 'sharedR001');
  assert.equal(queue[0]!['not_before'].toMillis(), T0 + RETRY_DELAY_MS);
  assert.equal(h.sent.length, 0);

  h.fake.log.length = 0;
  h.clock.t = T0 + RETRY_DELAY_MS;
  await runBackfill(h.deps());
  assert.deepEqual(h.sent.map((p) => p.request_id), ['sharedR001']);
  assert.equal(h.fake.read('articles/sharedR001')!['retry_count'], 1);
  assert.equal(queries(h).length, 0, 'a retry run reads no user articles');
  assert.equal((h.tracker()['retry_queue'] as unknown[]).length, 0);
});

test('retry list: an entry whose shared article is now archived leaves without a send', async () => {
  const h = harness();
  seedCompletedPass(h, { time_updated: T0 - 30 * MIN, item_id: '' }, {
    retry_queue: [
      {
        item_id: 'sharedR002',
        url: 'https://r2.example/page',
        domain: 'r2.example',
        retry_count: 1,
        not_before: Timestamp.fromMillis(T0 - 1),
      },
    ],
  });
  h.fake.put('articles/sharedR002', { archives: { rendered: { status: 'success' } } });

  await runBackfill(h.deps());
  assert.equal(h.sent.length, 0);
  assert.equal((h.tracker()['retry_queue'] as unknown[]).length, 0);
  assert.equal(queries(h).length, 0);
});

test('retry list: an access failure is not queued, an upstream failure is', async () => {
  for (const [message, queued] of [
    ['Gateway begin failed: 401 Unauthorized', 0],
    ['Gateway begin failed: 503 upstream', 1],
  ] as const) {
    const h = harness();
    seedCompletedPass(h, { time_updated: T0 - 30 * MIN, item_id: '' });
    userArticle(h, 'itemF0001', { timeUpdated: T0 - 5 * MIN, canonicalId: 'sharedF001' });
    await runBackfill(
      h.deps({
        beginArchive: async () => {
          throw new Error(message);
        },
      })
    );
    const queue = h.tracker()['retry_queue'] as Array<Record<string, unknown>>;
    assert.equal(queue.length, queued, message);
    if (queued) assert.equal(queue[0]!['item_id'], 'sharedF001');
  }
});

test('retry list: the entry beyond the cap drops the oldest', () => {
  const tracker = createDefaultTracker(Timestamp.fromMillis(T0));
  let dropped = false;
  for (let i = 0; i <= RETRY_QUEUE_MAX; i += 1) {
    dropped = enqueueRetry(
      tracker,
      {
        item_id: `sharedQ${i}`,
        url: `https://q${i}.example/page`,
        domain: `q${i}.example`,
        retry_count: 0,
        not_before: Timestamp.fromMillis(T0 + i),
      },
      RETRY_QUEUE_MAX
    );
  }
  assert.equal(dropped, true);
  assert.equal(tracker.retry_queue.length, RETRY_QUEUE_MAX);
  assert.equal(tracker.retry_queue[0]!.item_id, 'sharedQ1');
  assert.equal(tracker.retry_queue[RETRY_QUEUE_MAX - 1]!.item_id, `sharedQ${RETRY_QUEUE_MAX}`);
});

test('unlinked: an article without a server link creates no shared article; with one present it is sent', async () => {
  const h = harness();
  seedCompletedPass(h, { time_updated: T0 - 30 * MIN, item_id: '' });
  userArticle(h, 'itemU0001', { timeUpdated: T0 - 5 * MIN });

  await runBackfill(h.deps());
  assert.equal(h.sent.length, 0);
  assert.equal(h.fake.read('articles/itemU0001'), undefined);
  assert.deepEqual(h.tracker()['change_marker'], { time_updated: T0 - 5 * MIN, item_id: 'itemU0001' });

  const p = harness();
  seedCompletedPass(p, { time_updated: T0 - 30 * MIN, item_id: '' });
  userArticle(p, 'itemU0001', { timeUpdated: T0 - 5 * MIN });
  p.fake.put('articles/itemU0001', { url: 'https://itemu0001.example/page', status: 'failed', retry_count: 0 });
  await runBackfill(p.deps());
  assert.deepEqual(p.sent.map((s) => s.request_id), ['itemU0001']);
});
