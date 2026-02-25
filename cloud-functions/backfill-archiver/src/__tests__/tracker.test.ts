import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import {
  createDefaultTracker,
  isDomainBackedOff,
  normalizeTracker,
  recordDomainFailure,
  recordDomainSuccess,
  shouldPauseGlobally,
} from '../tracker.js';

test('normalizeTracker returns defaults when missing', () => {
  const tracker = normalizeTracker(undefined);
  assert.equal(tracker.batch.length, 0);
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
