import assert from 'node:assert/strict';
import test from 'node:test';

import { computeCoverage } from '../coverage.js';

test('computeCoverage: full coverage (existing superset of expected)', () => {
  const result = computeCoverage(new Set(['a', 'b']), new Set(['a', 'b', 'c']));
  assert.equal(result.covered, true);
  assert.deepEqual(result.missing, []);
  assert.equal(result.expectedCount, 2);
  assert.equal(result.existingCount, 3);
});

test('computeCoverage: exact coverage', () => {
  const result = computeCoverage(new Set(['a', 'b']), new Set(['a', 'b']));
  assert.equal(result.covered, true);
  assert.deepEqual(result.missing, []);
});

test('computeCoverage: partial coverage reports the missing keys', () => {
  const result = computeCoverage(new Set(['a', 'b', 'c']), new Set(['a']));
  assert.equal(result.covered, false);
  assert.deepEqual([...result.missing].sort(), ['b', 'c']);
});

test('computeCoverage: empty expected is trivially covered', () => {
  const result = computeCoverage(new Set(), new Set());
  assert.equal(result.covered, true);
  assert.equal(result.expectedCount, 0);
});
