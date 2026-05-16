import assert from 'node:assert/strict';
import test from 'node:test';
import { hasValidInternalApiKey, timingSafeEqualStrings } from '../auth.js';

test('timingSafeEqualStrings returns true only for exact match', () => {
  assert.equal(timingSafeEqualStrings('abc123', 'abc123'), true);
  assert.equal(timingSafeEqualStrings('abc123', 'abc124'), false);
  assert.equal(timingSafeEqualStrings('abc123', 'abc1234'), false);
});

test('hasValidInternalApiKey validates non-empty key with constant-time compare', () => {
  assert.equal(hasValidInternalApiKey('secret', 'secret'), true);
  assert.equal(hasValidInternalApiKey('wrong', 'secret'), false);
  assert.equal(hasValidInternalApiKey('', 'secret'), false);
  assert.equal(hasValidInternalApiKey(null, 'secret'), false);
});
