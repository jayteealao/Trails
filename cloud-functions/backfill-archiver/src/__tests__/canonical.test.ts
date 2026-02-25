import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPocket, resolveCanonicalFromUserDoc } from '../canonical.js';

test('resolveCanonicalFromUserDoc returns resolvedId when present', () => {
  const canonical = resolveCanonicalFromUserDoc('abc123', { resolvedId: 'xyz999' });
  assert.equal(canonical, 'xyz999');
});

test('resolveCanonicalFromUserDoc falls back to itemId', () => {
  const canonical = resolveCanonicalFromUserDoc('abc123', { resolvedId: '   ' });
  assert.equal(canonical, 'abc123');
});

test('buildPocket falls back resolved_id to canonical id', () => {
  const pocket = buildPocket(
    { favorite: '1', status: '0', timeAdded: 10, timeRead: 20 },
    'canonical-id'
  );
  assert.equal(pocket.resolved_id, 'canonical-id');
});
