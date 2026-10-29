import assert from 'node:assert/strict';
import test from 'node:test';

import { labelPath, userLabel } from '../report.js';

test('labelPath: replaces the user id of a user document path with its label', () => {
  const uid = 'someUserIdForTheTest';
  const labelled = labelPath(`users/${uid}/articles/item-1`);
  assert.equal(labelled, `users/${userLabel(uid)}/articles/item-1`);
  assert.ok(!labelled.includes(uid));
});

test('labelPath: replaces the user id of a marker path', () => {
  const uid = 'anotherUserForTheTest';
  const labelled = labelPath(`users/${uid}/articleMarkers/shared-1`);
  assert.equal(labelled, `users/${userLabel(uid)}/articleMarkers/shared-1`);
});

test('labelPath: leaves a shared article path unchanged', () => {
  assert.equal(labelPath('articles/shared-1'), 'articles/shared-1');
});
