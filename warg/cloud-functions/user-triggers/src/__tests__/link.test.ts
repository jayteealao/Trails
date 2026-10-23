import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { chooseSharedCandidate, isValidSharedId, withAlreadyExistsRetry } from '../link.js';
import { onUserArticleSave } from '../index.js';
import { RETRY_WINDOW_MS, withinRetryWindow } from '../handler.js';

test('isValidSharedId accepts 8 to 40 safe characters only', () => {
  assert.equal(isValidSharedId('a'.repeat(7)), false);
  assert.equal(isValidSharedId('a'.repeat(8)), true);
  assert.equal(isValidSharedId('aZ09_-bc'), true);
  assert.equal(isValidSharedId('a'.repeat(40)), true);
  assert.equal(isValidSharedId('a'.repeat(41)), false);
  assert.equal(isValidSharedId('abcd/efgh'), false);
  assert.equal(isValidSharedId('..'), false);
  assert.equal(isValidSharedId('abcd.efgh'), false);
  assert.equal(isValidSharedId(''), false);
});

const at = (ms: number) => Timestamp.fromMillis(ms);

test('chooseSharedCandidate prefers the oldest doc that is not a merged stub', () => {
  assert.deepEqual(
    chooseSharedCandidate([
      { id: 'newer000', data: { created_at: at(2000) } },
      { id: 'stub0000', data: { created_at: at(500), mergedInto: 'older000' } },
      { id: 'older000', data: { created_at: at(1000) } },
      { id: 'nodate00', data: {} },
    ]),
    { id: 'older000' }
  );
});

test('chooseSharedCandidate gives a tie to the smaller id', () => {
  assert.deepEqual(
    chooseSharedCandidate([
      { id: 'bbbbbbbb', data: { created_at: at(1000) } },
      { id: 'aaaaaaaa', data: { created_at: at(1000) } },
    ]),
    { id: 'aaaaaaaa' }
  );
  assert.deepEqual(
    chooseSharedCandidate([
      { id: 'dddddddd', data: {} },
      { id: 'cccccccc', data: {} },
    ]),
    { id: 'cccccccc' }
  );
});

test('chooseSharedCandidate follows the target when every doc is a merged stub', () => {
  assert.deepEqual(
    chooseSharedCandidate([
      { id: 'stub0002', data: { created_at: at(2000), mergedInto: 'winner02' } },
      { id: 'stub0001', data: { created_at: at(1000), mergedInto: 'winner01' } },
    ]),
    { followMergedInto: 'winner01' }
  );
});

test('chooseSharedCandidate returns null for no docs', () => {
  assert.equal(chooseSharedCandidate([]), null);
});

test('withAlreadyExistsRetry re-runs once after ALREADY_EXISTS', async () => {
  let calls = 0;
  const result = await withAlreadyExistsRetry(async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('exists'), { code: 6 });
    return 'second';
  });
  assert.equal(result, 'second');
  assert.equal(calls, 2);
});

test('withAlreadyExistsRetry rethrows other errors without a re-run', async () => {
  let calls = 0;
  await assert.rejects(
    withAlreadyExistsRetry(async () => {
      calls += 1;
      throw Object.assign(new Error('aborted'), { code: 10 });
    }),
    /aborted/
  );
  assert.equal(calls, 1);
});

test('withAlreadyExistsRetry makes at most two calls', async () => {
  let calls = 0;
  await assert.rejects(
    withAlreadyExistsRetry(async () => {
      calls += 1;
      throw Object.assign(new Error('exists'), { code: 6 });
    }),
    /exists/
  );
  assert.equal(calls, 2);
});

test('onUserArticleSave fires on the creation of a user article', () => {
  const trigger = onUserArticleSave.__endpoint.eventTrigger;
  assert.ok(trigger);
  assert.equal(trigger.eventType, 'google.cloud.firestore.document.v1.created');
  assert.equal(trigger.eventFilterPathPatterns?.['document'], 'users/{userId}/articles/{itemId}');
});

test('onUserArticleSave is deployed with retry on', () => {
  assert.equal(onUserArticleSave.__endpoint.eventTrigger?.retry, true);
});

test('withinRetryWindow retries a recent event only', () => {
  const now = 10 * RETRY_WINDOW_MS;
  assert.equal(withinRetryWindow(now - 1000, now), true);
  assert.equal(withinRetryWindow(now - RETRY_WINDOW_MS, now), false);
  assert.equal(withinRetryWindow(undefined, now), false);
  assert.equal(withinRetryWindow(Number.NaN, now), false);
});
