import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import {
  deriveStatus,
  hasSufficientArtifact,
  STUCK_TIMEOUT_MS,
} from '../article-status.js';

test('hasSufficientArtifact is true when any of rendered/singlefile/monolith succeeds', () => {
  assert.equal(hasSufficientArtifact({ archives: { rendered: { status: 'success' } } }), true);
  assert.equal(hasSufficientArtifact({ archives: { singlefile: { status: 'success' } } }), true);
  assert.equal(hasSufficientArtifact({ archives: { monolith: { status: 'success' } } }), true);
});

test('hasSufficientArtifact is false when only readability/markdown/pdf succeed', () => {
  assert.equal(
    hasSufficientArtifact({
      archives: {
        readability: { status: 'success' },
        markdown: { status: 'success' },
        pdf: { status: 'success' },
      },
    }),
    false
  );
});

test('hasSufficientArtifact is false for missing/empty archives', () => {
  assert.equal(hasSufficientArtifact({}), false);
  assert.equal(hasSufficientArtifact({ archives: null }), false);
  assert.equal(hasSufficientArtifact({ archives: {} }), false);
});

test('deriveStatus → complete when sufficient artifact present (regardless of status field)', () => {
  const result = deriveStatus(
    { status: 'failed', archives: { rendered: { status: 'success' } } },
    Date.now()
  );
  assert.equal(result, 'complete');
});

test('deriveStatus → processing when processing_started_at is recent', () => {
  const result = deriveStatus(
    {
      processing_started_at: Timestamp.fromMillis(Date.now() - 5000),
      archives: {},
    },
    Date.now()
  );
  assert.equal(result, 'processing');
});

test('deriveStatus → failed when processing_started_at is stale and no artifacts', () => {
  const result = deriveStatus(
    {
      processing_started_at: Timestamp.fromMillis(Date.now() - STUCK_TIMEOUT_MS - 1000),
      archives: { workflow_settlement: { status: 'stuck' } },
    },
    Date.now()
  );
  assert.equal(result, 'failed');
});

test('deriveStatus → partial when a non-sufficient archive succeeded', () => {
  const result = deriveStatus(
    { archives: { readability: { status: 'success' } } },
    Date.now()
  );
  assert.equal(result, 'partial');
});

test('deriveStatus → pending when nothing has happened', () => {
  const result = deriveStatus({ archives: {} }, Date.now());
  assert.equal(result, 'pending');
});

test('deriveStatus → abandoned when retries exhausted and no artifact', () => {
  const result = deriveStatus(
    {
      retry_count: 2,
      archives: { workflow_settlement: { status: 'failed' } },
    },
    Date.now()
  );
  assert.equal(result, 'abandoned');
});

test('deriveStatus → abandoned immediately for DATA_ISSUE failure class', () => {
  const result = deriveStatus(
    {
      retry_count: 0,
      failure: { class: 'DATA_ISSUE' },
      archives: {},
    },
    Date.now()
  );
  assert.equal(result, 'abandoned');
});

test('deriveStatus → failed for WORKFLOW_TRIGGER under retry budget', () => {
  const result = deriveStatus(
    {
      retry_count: 0,
      failure: { class: 'WORKFLOW_TRIGGER' },
      archives: { gateway_begin: { status: 'failed' } },
    },
    Date.now()
  );
  assert.equal(result, 'failed');
});
