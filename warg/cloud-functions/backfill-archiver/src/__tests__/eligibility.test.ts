import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import { classifyItem, getRetryCount } from '../eligibility.js';

const STUCK_TIMEOUT_MS = 30 * 60 * 1000;

test('classifyItem marks complete when rendered archive exists only', () => {
  const status = classifyItem(
    {
      status: 'processing',
      archives: {
        rendered: { status: 'success' },
      },
    },
    Date.now(),
    STUCK_TIMEOUT_MS
  );
  assert.equal(status, 'complete');
});

test('classifyItem marks complete when singlefile archive exists only', () => {
  const status = classifyItem(
    {
      status: 'failed',
      archives: {
        singlefile: { status: 'success' },
      },
    },
    Date.now(),
    STUCK_TIMEOUT_MS
  );
  assert.equal(status, 'complete');
});

test('classifyItem marks complete when monolith archive exists only', () => {
  const status = classifyItem(
    {
      status: 'pending',
      archives: {
        monolith: { status: 'success' },
      },
    },
    Date.now(),
    STUCK_TIMEOUT_MS
  );
  assert.equal(status, 'complete');
});

test('classifyItem does NOT mark complete when only readability/markdown succeed', () => {
  const status = classifyItem(
    {
      status: 'processing',
      archives: {
        readability: { status: 'success' },
        markdown: { status: 'success' },
      },
    },
    Date.now(),
    STUCK_TIMEOUT_MS
  );
  assert.notEqual(status, 'complete');
});

test('classifyItem ignores absent metadata.title when archive is sufficient', () => {
  const status = classifyItem(
    {
      status: 'failed',
      // intentionally no metadata block
      archives: {
        rendered: { status: 'success' },
      },
    },
    Date.now(),
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

test('classifyItem marks abandoned as failed for backfill purposes', () => {
  const status = classifyItem(
    {
      status: 'abandoned',
      archives: {},
    },
    Date.now(),
    STUCK_TIMEOUT_MS
  );
  assert.equal(status, 'failed');
});

test('classifyItem marks done without sufficient archives as failed', () => {
  const status = classifyItem(
    {
      status: 'done',
      archives: {
        readability: { status: 'success' },
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

test('classifyItem marks recent processing as in_progress', () => {
  const started = Timestamp.fromMillis(Date.now() - 5000);
  const status = classifyItem(
    {
      status: 'processing',
      processing_started_at: started,
      archives: {},
    },
    Date.now(),
    STUCK_TIMEOUT_MS
  );
  assert.equal(status, 'in_progress');
});

test('getRetryCount returns numeric retry_count and defaults to zero', () => {
  assert.equal(getRetryCount({ retry_count: 2 }), 2);
  assert.equal(getRetryCount({ retry_count: '2' }), 0);
  assert.equal(getRetryCount(undefined), 0);
});
