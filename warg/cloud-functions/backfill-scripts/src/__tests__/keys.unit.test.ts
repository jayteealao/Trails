import assert from 'node:assert/strict';
import test from 'node:test';

import { ARTICLE_MARKERS_COLLECTION, deriveMarkerKeys, markerBody } from '../keys.js';

test('deriveMarkerKeys: itemId only when resolvedId is null', () => {
  assert.deepEqual(deriveMarkerKeys('item-1', null), ['item-1']);
});

test('deriveMarkerKeys: itemId only when resolvedId is undefined', () => {
  assert.deepEqual(deriveMarkerKeys('item-1', undefined), ['item-1']);
});

test('deriveMarkerKeys: itemId only when resolvedId is blank/whitespace', () => {
  assert.deepEqual(deriveMarkerKeys('item-1', ''), ['item-1']);
  assert.deepEqual(deriveMarkerKeys('item-1', '   '), ['item-1']);
});

test('deriveMarkerKeys: itemId only when resolvedId equals itemId', () => {
  assert.deepEqual(deriveMarkerKeys('item-1', 'item-1'), ['item-1']);
});

test('deriveMarkerKeys: both keys when resolvedId is distinct', () => {
  assert.deepEqual(deriveMarkerKeys('item-1', 'resolved-9'), ['item-1', 'resolved-9']);
});

test('deriveMarkerKeys: raw resolvedId value is preserved (Android parity)', () => {
  // Non-blank but surrounded by whitespace: kept verbatim, matching the Kotlin
  // markerKeysFor which pushes the raw value.
  assert.deepEqual(deriveMarkerKeys('item-1', ' resolved-9 '), ['item-1', ' resolved-9 ']);
});

test('ARTICLE_MARKERS_COLLECTION is the pinned name', () => {
  assert.equal(ARTICLE_MARKERS_COLLECTION, 'articleMarkers');
});

test('markerBody: carries key, default source backfill, and a createdAt sentinel', () => {
  const body = markerBody('k1');
  assert.equal(body['key'], 'k1');
  assert.equal(body['source'], 'backfill');
  assert.ok('createdAt' in body);
});

test('markerBody: honors an explicit source', () => {
  assert.equal(markerBody('k1', 'sync')['source'], 'sync');
});
