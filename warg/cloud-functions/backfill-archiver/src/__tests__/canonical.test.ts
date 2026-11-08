import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPocket } from '../canonical.js';

test('buildPocket falls back resolved_id to canonical id', () => {
  const pocket = buildPocket(
    { favorite: '1', status: '0', timeAdded: 10, timeRead: 20 },
    'canonical-id'
  );
  assert.equal(pocket.resolved_id, 'canonical-id');
});
