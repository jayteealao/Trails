import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeUrl } from '@warg/url-normalizer';
import { Timestamp } from 'firebase-admin/firestore';

import { runMergePassA } from '../merge-pass-a.js';
import { runRederivePassB, type BeginArchive } from '../rederive-pass-b.js';
import { makeRecordingDb, type RecordedWrite } from './recording-firestore.js';

// The exact writes the merge and re-derive passes make: method, path, data
// (normalised), the field-value form and the options, in call order. They pin
// the wire format, so a change to how a write is made must leave these
// expectations as they are. Every id here is synthetic.

const at = (iso: string): Timestamp => Timestamp.fromDate(new Date(iso));
const MERGE_URL = 'https://merge.example.com/p';

test('the merge pass copies the archive under its whole key, then moves the link, then marks the loser', async () => {
  const recording = makeRecordingDb({
    'articles/mwinner0001': {
      url: MERGE_URL,
      normalizedUrl: normalizeUrl(MERGE_URL),
      created_at: at('2020-01-01T00:00:00Z'),
      archives: {},
    },
    'articles/mloser00001': {
      url: `${MERGE_URL}?utm_source=x`,
      created_at: at('2021-01-01T00:00:00Z'),
      archives: { 'readability.v2': { status: 'success', gcs_path: 'gs://b/mloser00001/r.html' } },
    },
    'users/userA/articles/itemA0001': {
      url: `${MERGE_URL}?utm_source=x`,
      canonicalId: 'mloser00001',
      resolvedId: 'mloser00001',
    },
  });

  const result = await runMergePassA(recording.db, { apply: true });

  assert.equal(result.errors, 0);
  assert.deepEqual(recording.writes, [
    {
      method: 'update',
      via: 'bulk',
      path: 'articles/mwinner0001',
      data: {
        field: ['archives', 'readability.v2'],
        value: { status: 'success', gcs_path: 'gs://b/mloser00001/r.html' },
      },
      options: {},
    },
    {
      method: 'update',
      via: 'bulk',
      path: 'articles/mloser00001',
      data: { field: 'normalizedUrl', value: normalizeUrl(MERGE_URL) },
      options: {},
    },
    {
      method: 'set',
      via: 'bulk',
      path: 'users/userA/articleMarkers/mwinner0001',
      data: { key: 'mwinner0001', itemId: 'itemA0001', createdAt: '<fieldvalue>', source: 'merge' },
      options: { merge: true },
    },
    {
      method: 'update',
      via: 'bulk',
      path: 'users/userA/articles/itemA0001',
      data: { field: 'canonicalId', value: 'mwinner0001' },
      options: {},
    },
    {
      method: 'update',
      via: 'bulk',
      path: 'articles/mloser00001',
      data: { field: 'mergedInto', value: 'mwinner0001' },
      options: {},
    },
  ]);
  // The dotted archive key stays one key of the winner's archives map.
  assert.deepEqual(recording.read('articles/mwinner0001')?.['archives'], {
    'readability.v2': { status: 'success', gcs_path: 'gs://b/mloser00001/r.html' },
  });
});

const RD = (path: string): string => `https://rd.example.com/${path}`;

/**
 * The double's update times count up from 1000; a write stamped with the wall
 * clock (Timestamp.now()) shows as '<now>'.
 */
function withWallClock(value: unknown): unknown {
  if (typeof value === 'string') {
    const millis = /^<ts:(\d+)>$/.exec(value)?.[1];
    return millis !== undefined && Number(millis) > 1e12 ? '<now>' : value;
  }
  if (Array.isArray(value)) return value.map(withWallClock);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withWallClock(v)]));
  }
  return value;
}

const newShared = (id: string, url: string): RecordedWrite => ({
  method: 'create',
  via: 'tx',
  path: `articles/${id}`,
  data: {
    item_id: id,
    url,
    normalizedUrl: normalizeUrl(url),
    domain: 'rd.example.com',
    created_at: '<now>',
    status: 'pending',
    archives: {},
    pocket: {},
    stats: { last_accessed: '', total_saves: 1, total_views: 0 },
  },
  options: {},
});

const marker = (via: RecordedWrite['via'], key: string, itemId: string): RecordedWrite => ({
  method: 'set',
  via,
  path: `users/userA/articleMarkers/${key}`,
  data: { key, itemId, createdAt: '<fieldvalue>', source: 'rederive' },
  options: {},
});

const txLink = (itemId: string): RecordedWrite => ({
  method: 'update',
  via: 'tx',
  path: `users/userA/articles/${itemId}`,
  data: { canonicalId: itemId, resolvedId: itemId },
  options: {},
});

test('the re-derive pass clears, creates, starts, fails, changes and clears links with their preconditions', async () => {
  const recording = makeRecordingDb({
    'articles/shexist0001': {
      url: RD('exist'),
      normalizedUrl: normalizeUrl(RD('exist')),
      created_at: at('2020-01-01T00:00:00Z'),
    },
    'articles/shother0001': {
      url: RD('other'),
      normalizedUrl: normalizeUrl(RD('other')),
      created_at: at('2020-01-02T00:00:00Z'),
    },
    // Linked elsewhere, but its URL has no shared article: cleared first, then created.
    'users/userA/articles/itemclr0001': { url: RD('new-one'), canonicalId: 'shother0001' },
    // Not linked, no shared article: created; its archive does not start.
    'users/userA/articles/itemfail001': { url: RD('new-two') },
    // Linked to the wrong shared article: the link changes.
    'users/userA/articles/itemchg0001': { url: RD('exist'), canonicalId: 'shother0001' },
    // No URL: the link is cleared.
    'users/userA/articles/itemnone001': { canonicalId: 'shother0001' },
  });
  const beginArchive: BeginArchive = async (payload) => {
    if (payload.request_id === 'itemfail001') throw new Error('Gateway begin failed: 503');
    return { requestId: `req-${payload.request_id}` };
  };

  const result = await runRederivePassB(recording.db, { apply: true, beginArchive });

  assert.equal(result.errors, 0);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(withWallClock(recording.writes), [
    {
      method: 'update',
      via: 'ref',
      path: 'users/userA/articles/itemclr0001',
      data: { canonicalId: '<delete>' },
      options: { lastUpdateTime: '<ts:1003>' },
    },
    newShared('itemclr0001', RD('new-one')),
    marker('tx', 'itemclr0001', 'itemclr0001'),
    txLink('itemclr0001'),
    {
      method: 'update',
      via: 'ref',
      path: 'articles/itemclr0001',
      data: { warg_request_id: 'req-itemclr0001', status: 'processing', processing_started_at: '<now>' },
      options: {},
    },
    {
      method: 'update',
      via: 'ref',
      path: 'users/userA/articles/itemclr0001',
      data: { archival_triggered: true },
      options: {},
    },
    newShared('itemfail001', RD('new-two')),
    marker('tx', 'itemfail001', 'itemfail001'),
    txLink('itemfail001'),
    {
      method: 'update',
      via: 'ref',
      path: 'articles/itemfail001',
      data: { status: 'failed', error: 'Gateway begin failed: 503', failed_at: '<now>' },
      options: {},
    },
    {
      method: 'update',
      via: 'bulk',
      path: 'users/userA/articles/itemchg0001',
      data: { canonicalId: 'shexist0001', resolvedId: 'shexist0001' },
      options: { lastUpdateTime: '<ts:1005>' },
    },
    {
      method: 'update',
      via: 'bulk',
      path: 'users/userA/articles/itemnone001',
      data: { canonicalId: '<delete>' },
      options: { lastUpdateTime: '<ts:1006>' },
    },
    marker('bulk', 'shexist0001', 'itemchg0001'),
  ]);
});
