import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import {
  createDefaultTracker,
  enqueueRetry,
  isDomainBackedOff,
  normalizeTracker,
  recordDomainFailure,
  recordDomainSuccess,
  shouldPauseGlobally,
  takeDueRetries,
} from '../tracker.js';

test('normalizeTracker returns defaults when missing', () => {
  const tracker = normalizeTracker(undefined);
  assert.equal(tracker.batch.length, 0);
  assert.equal(tracker.scan_cursor, null);
  assert.equal(tracker.scan_exhausted, false);
  assert.equal(tracker.paused, false);
  assert.equal(tracker.last_run_summary.failed, 0);
});

test('domain backoff triggers after threshold failures and clears on success', () => {
  const tracker = createDefaultTracker();
  const now = Date.now();

  recordDomainFailure(tracker, 'example.com', now, 2, 60000, 'boom');
  assert.equal(isDomainBackedOff(tracker, 'example.com', now), false);

  recordDomainFailure(tracker, 'example.com', now, 2, 60000, 'boom-again');
  assert.equal(isDomainBackedOff(tracker, 'example.com', now), true);

  recordDomainSuccess(tracker, 'example.com');
  assert.equal(isDomainBackedOff(tracker, 'example.com', now), false);
});

test('shouldPauseGlobally only pauses on high access/auth failure ratio', () => {
  assert.equal(
    shouldPauseGlobally(
      {
        ACCESS_OR_AUTH: 3,
        WORKFLOW_TRIGGER: 0,
        TRANSIENT_UPSTREAM: 0,
        DATA_ISSUE: 0,
      },
      3
    ),
    true
  );

  assert.equal(
    shouldPauseGlobally(
      {
        ACCESS_OR_AUTH: 1,
        WORKFLOW_TRIGGER: 1,
        TRANSIENT_UPSTREAM: 1,
        DATA_ISSUE: 0,
      },
      3
    ),
    false
  );
});

test('normalizeTracker keeps existing run lease and pause timestamps', () => {
  const now = Timestamp.now();
  const tracker = normalizeTracker({
    run_lease: {
      owner: 'owner-1',
      expires_at: now,
    },
    paused: true,
    global_pause_until: now,
  });

  assert.equal(tracker.run_lease?.owner, 'owner-1');
  assert.equal(tracker.paused, true);
  assert.equal(tracker.global_pause_until?.toMillis(), now.toMillis());
});

test('normalizeTracker gives the pass fields their defaults when missing', () => {
  const tracker = normalizeTracker({ batch_number: 3 });
  assert.equal(tracker.pass_label, null);
  assert.equal(tracker.pass_started_at, null);
  assert.equal(tracker.pass_completed_at, null);
  assert.equal(tracker.change_marker, null);
  assert.deepEqual(tracker.retry_queue, []);
});

test('normalizeTracker keeps a valid pass state and drops a malformed marker', () => {
  const started = Timestamp.fromMillis(1_800_000_000_000);
  const tracker = normalizeTracker({
    pass_label: '2',
    pass_started_at: started,
    pass_completed_at: started,
    change_marker: { time_updated: 1_800_000_000_000, item_id: 'itemM0001' },
  });
  assert.equal(tracker.pass_label, '2');
  assert.equal(tracker.pass_started_at?.toMillis(), started.toMillis());
  assert.deepEqual(tracker.change_marker, { time_updated: 1_800_000_000_000, item_id: 'itemM0001' });

  assert.equal(normalizeTracker({ change_marker: { time_updated: 'soon', item_id: 'x' } }).change_marker, null);
  assert.equal(normalizeTracker({ change_marker: { time_updated: 5 } }).change_marker, null);
  assert.equal(normalizeTracker({ change_marker: [5, 'x'] }).change_marker, null);
});

test('normalizeTracker drops retry entries without an id or url', () => {
  const tracker = normalizeTracker({
    retry_queue: [
      { item_id: 'sharedN001', url: 'https://n1.example/a', retry_count: 1, not_before: Timestamp.fromMillis(5) },
      { item_id: 'sharedN002' },
      { url: 'https://n3.example/a' },
      null,
    ],
  });
  assert.equal(tracker.retry_queue.length, 1);
  assert.equal(tracker.retry_queue[0]!.item_id, 'sharedN001');
  assert.equal(tracker.retry_queue[0]!.domain, 'n1.example');
  assert.equal(tracker.retry_queue[0]!.not_before.toMillis(), 5);
});

test('enqueueRetry keeps one entry per shared article with the higher retry count', () => {
  const tracker = createDefaultTracker();
  const entry = (retry: number, at: number) => ({
    item_id: 'sharedE001',
    url: 'https://e1.example/a',
    domain: 'e1.example',
    retry_count: retry,
    not_before: Timestamp.fromMillis(at),
  });
  assert.equal(enqueueRetry(tracker, entry(0, 10)), false);
  enqueueRetry(tracker, entry(1, 20));
  enqueueRetry(tracker, entry(0, 30));
  assert.equal(tracker.retry_queue.length, 1);
  assert.equal(tracker.retry_queue[0]!.retry_count, 1);
  assert.equal(tracker.retry_queue[0]!.not_before.toMillis(), 20);
});

test('takeDueRetries returns due entries in not_before order without removing them', () => {
  const tracker = createDefaultTracker();
  for (const [id, at] of [['sharedD003', 30], ['sharedD001', 10], ['sharedD009', 90], ['sharedD002', 20]] as const) {
    enqueueRetry(tracker, {
      item_id: id,
      url: `https://${id}.example/a`,
      domain: `${id}.example`,
      retry_count: 0,
      not_before: Timestamp.fromMillis(at),
    });
  }
  assert.deepEqual(takeDueRetries(tracker, 30, 10).map((e) => e.item_id), ['sharedD001', 'sharedD002', 'sharedD003']);
  assert.deepEqual(takeDueRetries(tracker, 30, 2).map((e) => e.item_id), ['sharedD001', 'sharedD002']);
  assert.equal(tracker.retry_queue.length, 4);
});
