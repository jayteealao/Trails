import assert from 'node:assert/strict';
import test from 'node:test';

import {
  groupByNormalizedUrl,
  linkTargetOf,
  markerNeedsFor,
  pickWinner,
  planGroup,
  planLinkMoves,
  planSharedArticles,
} from '../merge.js';
import type { ArchiveView, SharedDocView, UserArticleView } from '../merge.js';

function doc(
  id: string,
  createdMillis: number,
  extra: Partial<Omit<SharedDocView, 'id' | 'createdMillis'>> = {},
): SharedDocView {
  return {
    id,
    url: 'https://example.com/a',
    createdMillis,
    archives: {},
    hasMetadata: false,
    ...extra,
  };
}

function article(itemId: string, extra: Partial<UserArticleView> = {}): UserArticleView {
  return { uid: 'u1', uidLabel: 'label-u1', itemId, ...extra };
}

const success = (path: string): ArchiveView => ({ status: 'success', gcs_path: path });

test('groupByNormalizedUrl: URLs that differ only by utm_source group together', () => {
  const groups = groupByNormalizedUrl([
    doc('a', 1, { url: 'https://example.com/post' }),
    doc('b', 2, { url: 'https://example.com/post?utm_source=x' }),
    doc('c', 3, { url: 'https://example.com/other' }),
  ]);
  assert.equal(groups.size, 2);
  const ids = [...groups.values()].map((members) => members.map((m) => m.id).sort());
  assert.deepEqual(ids.sort(), [['a', 'b'], ['c']]);
});

test('pickWinner: the lowest createdMillis wins', () => {
  assert.equal(pickWinner([doc('b', 20), doc('a', 30), doc('c', 10)])?.id, 'c');
});

test('pickWinner: the lower id breaks a tie', () => {
  assert.equal(pickWinner([doc('zz', 10), doc('aa', 10)])?.id, 'aa');
});

test('pickWinner: a stub is never the winner', () => {
  assert.equal(pickWinner([doc('old', 1, { mergedInto: 'x' }), doc('new', 2)])?.id, 'new');
});

test('pickWinner and planGroup: an all-stub group has no winner', () => {
  const members = [doc('a', 1, { mergedInto: 'x' }), doc('b', 2, { mergedInto: 'x' })];
  assert.equal(pickWinner(members), null);
  assert.equal(planGroup('k', members), null);
});

test('planSharedArticles: an all-stub group is an anomaly', () => {
  const plan = planSharedArticles([
    doc('a', 1, { mergedInto: 'x' }),
    doc('b', 2, { mergedInto: 'x' }),
  ]);
  assert.equal(plan.groups.length, 0);
  assert.equal(plan.anomalies.filter((a) => a.kind === 'all-stubs').length, 1);
});

test('planGroup: no archive copy when the winner already has a successful entry', () => {
  const plan = planGroup('k', [
    doc('w', 1, { archives: { pdf: success('gs://b/w.pdf') } }),
    doc('l', 2, { archives: { pdf: success('gs://b/l.pdf') } }),
  ]);
  assert.deepEqual(plan?.archiveCopies, []);
});

test('planGroup: the source is the oldest loser with a successful entry', () => {
  const plan = planGroup('k', [
    doc('w', 1),
    doc('young', 30, { archives: { pdf: success('gs://b/young.pdf') } }),
    doc('mid', 20, { archives: { pdf: success('gs://b/mid.pdf') } }),
  ]);
  assert.deepEqual(plan?.archiveCopies, [
    { key: 'pdf', fromId: 'mid', entry: success('gs://b/mid.pdf') },
  ]);
});

test('planGroup: a winner entry that is not successful is replaced by a loser success', () => {
  const plan = planGroup('k', [
    doc('w', 1, { archives: { pdf: { status: 'failed' } } }),
    doc('l', 2, { archives: { pdf: success('gs://b/l.pdf') } }),
  ]);
  assert.equal(plan?.archiveCopies.length, 1);
  assert.equal(plan?.archiveCopies[0]?.fromId, 'l');
});

test('planGroup: uploading, failed or path-less loser entries are never copied', () => {
  const plan = planGroup('k', [
    doc('w', 1),
    doc('l', 2, {
      archives: {
        screenshot: { status: 'uploading', gcs_path: 'gs://b/s.png' },
        pdf: { status: 'failed', gcs_path: 'gs://b/p.pdf' },
        html: { status: 'success', gcs_path: '  ' },
      },
    }),
  ]);
  assert.deepEqual(plan?.archiveCopies, []);
});

test('planGroup: new losers and stubs pointing elsewhere get stub writes', () => {
  const plan = planGroup('k', [
    doc('w', 1),
    doc('fresh', 2),
    doc('repoint', 3, { mergedInto: 'gone' }),
    doc('done', 4, { mergedInto: 'w' }),
  ]);
  assert.deepEqual(plan?.loserIds, ['fresh', 'repoint', 'done']);
  assert.deepEqual(plan?.stubWrites, [
    { id: 'fresh', mergedInto: 'w' },
    { id: 'repoint', mergedInto: 'w' },
  ]);
});

test('planSharedArticles: every loser, stubs included, maps to the winner', () => {
  const plan = planSharedArticles([doc('w', 1), doc('l', 2), doc('s', 3, { mergedInto: 'w' })]);
  assert.deepEqual([...plan.loserToWinner].sort(), [
    ['l', 'w'],
    ['s', 'w'],
  ]);
});

test('planSharedArticles: a doc with no url is an anomaly and gets no normalizedUrl', () => {
  const plan = planSharedArticles([doc('nourl', 1, { url: undefined }), doc('blank', 2, { url: ' ' })]);
  assert.deepEqual(
    plan.anomalies.filter((a) => a.kind === 'no-url').map((a) => (a.kind === 'no-url' ? a.id : '')),
    ['nourl', 'blank'],
  );
  assert.deepEqual(plan.normalizedUrlWrites, []);
});

test('planSharedArticles: normalizedUrl is written only when missing or different', () => {
  const plan = planSharedArticles([
    doc('same', 1, { url: 'https://example.com/a', normalizedUrl: 'https://example.com/a' }),
    doc('missing', 2, { url: 'https://example.com/b' }),
  ]);
  assert.deepEqual(plan.normalizedUrlWrites, [
    { id: 'missing', normalizedUrl: 'https://example.com/b' },
  ]);
});

test('planSharedArticles: a winner without metadata that a loser has is an anomaly', () => {
  const plan = planSharedArticles([doc('w', 1), doc('l', 2, { hasMetadata: true })]);
  assert.deepEqual(
    plan.anomalies.filter((a) => a.kind === 'metadata-gap'),
    [{ kind: 'metadata-gap', winnerId: 'w', loserIds: ['l'] }],
  );
});

test('linkTargetOf: canonicalId, then resolvedId, then itemId; blank values skipped', () => {
  assert.equal(linkTargetOf(article('i', { canonicalId: 'c', resolvedId: 'r' })), 'c');
  assert.equal(linkTargetOf(article('i', { canonicalId: ' ', resolvedId: 'r' })), 'r');
  assert.equal(linkTargetOf(article('i', { canonicalId: '', resolvedId: '' })), 'i');
  assert.equal(linkTargetOf(article('i')), 'i');
});

test('planLinkMoves: moves only articles that link to a loser and are not on the winner', () => {
  const loserToWinner = new Map([['l', 'w']]);
  const moves = planLinkMoves(
    [
      article('i1', { resolvedId: 'l' }),
      article('l'),
      article('i3', { canonicalId: 'w' }),
      article('i4', { resolvedId: 'other' }),
    ],
    loserToWinner,
  );
  assert.deepEqual(
    moves.map((m) => [m.itemId, m.from, m.to]),
    [
      ['i1', 'l', 'w'],
      ['l', 'l', 'w'],
    ],
  );
});

test('markerNeedsFor: one need per user and winner, also for links already on a winner', () => {
  const articles = [article('i1', { resolvedId: 'l' }), article('i2', { canonicalId: 'w' })];
  const moves = planLinkMoves(articles, new Map([['l', 'w']]));
  const needs = markerNeedsFor(articles, moves, new Set(['w']));
  assert.deepEqual(needs, [{ uid: 'u1', uidLabel: 'label-u1', itemId: 'i1', key: 'w' }]);

  const resumed = markerNeedsFor([article('i2', { canonicalId: 'w' })], [], new Set(['w']));
  assert.deepEqual(resumed, [{ uid: 'u1', uidLabel: 'label-u1', itemId: 'i2', key: 'w' }]);
});
