import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeUrl } from '@warg/url-normalizer';
import { Timestamp } from 'firebase-admin/firestore';

import { runMergePassA } from '../merge-pass-a.js';
import { makeRecordingDb } from './recording-firestore.js';

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
