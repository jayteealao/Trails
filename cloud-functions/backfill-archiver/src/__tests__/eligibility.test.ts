import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import { classifyItem, getRetryCount } from '../eligibility.js';

const STUCK_TIMEOUT_MS = 30 * 60 * 1000;

test('classifyItem marks complete when core artifacts and metadata exist', () => {
  const now = Date.now();
  const status = classifyItem(
    {
      status: 'done',
      metadata: { title: 'Hello' },
      archives: {
        rendered: { status: 'success' },
        readability: { status: 'success' },
        markdown: { status: 'success' },
        singlefile: { status: 'success' },
      },
    },
    now,
    STUCK_TIMEOUT_MS
  );
  assert.equal(status, 'complete');
});

test('classifyItem marks incomplete as failed', () => {
  const status = classifyItem(
    {
      status: 'incomplete',
      archives: {},
    },
    Date.now(),
    STUCK_TIMEOUT_MS
  );
  assert.equal(status, 'failed');
});

test('classifyItem marks done without core archives as failed', () => {
  const status = classifyItem(
    {
      status: 'done',
      metadata: { title: 'No artifacts' },
      archives: {
        rendered: { status: 'success' },
      },
    },
    Date.now(),
    STUCK_TIMEOUT_MS
  );
  assert.equal(status, 'failed');
});

test('classifyItem marks long-running processing as stuck', () => {
  const started = Timestamp.fromMillis(Date.now() - STUCK_TIMEOUT_MS - 1000);
  const status = classifyItem(
    {
      status: 'processing',
      processing_started_at: started,
      archives: {},
    },
    Date.now(),
    STUCK_TIMEOUT_MS
  );
  assert.equal(status, 'stuck');
});

test('getRetryCount returns numeric retry_count and defaults to zero', () => {
  assert.equal(getRetryCount({ retry_count: 2 }), 2);
  assert.equal(getRetryCount({ retry_count: '2' }), 0);
  assert.equal(getRetryCount(undefined), 0);
});
