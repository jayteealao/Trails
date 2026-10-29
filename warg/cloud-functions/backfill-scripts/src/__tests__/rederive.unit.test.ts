import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeUrl } from '@warg/url-normalizer';
import { TRIGGER_MARKER_SOURCE } from '@warg/user-triggers/dist/shared/link.js';

import { MERGE_MARKER_SOURCE } from '../merge-pass-a.js';
import {
  buildIndex,
  checkPreconditions,
  deriveFor,
  isDeleted,
  planAll,
  planUser,
  REDERIVE_MARKER_SOURCE,
  SERVER_MARKER_SOURCES,
} from '../rederive.js';
import type { ArticleView, MarkerView, SharedView, UserInput } from '../rederive.js';

function shared(id: string, url: string, created: number, extra: Partial<SharedView> = {}): SharedView {
  const mergedInto = extra.mergedInto;
  return {
    id,
    url,
    normalizedUrl: normalizeUrl(url),
    hasSuccessArchive: false,
    ...extra,
    data: {
      created_at: { toMillis: () => created },
      ...(mergedInto === undefined ? {} : { mergedInto }),
    },
  };
}

function article(itemId: string, url: string | undefined, extra: Partial<ArticleView> = {}): ArticleView {
  return { uid: 'userA', uidLabel: 'labelA', itemId, url, deleted: false, ...extra };
}

function user(articles: ArticleView[], markers: MarkerView[] = [], uid = 'userA'): UserInput {
  return {
    uid,
    uidLabel: `label-${uid}`,
    articles: articles.map((a) => ({ ...a, uid, uidLabel: `label-${uid}` })),
    markers,
  };
}

test('deriveFor: a utm_source variant derives the same shared article', () => {
  const index = buildIndex([shared('sharedAAA1', 'https://ex.com/a', 1)]);
  assert.deepEqual(deriveFor(index, 'https://ex.com/a?utm_source=x', 'itemAAAA1'), {
    kind: 'link',
    id: 'sharedAAA1',
    normalizedUrl: normalizeUrl('https://ex.com/a'),
  });
});

test('deriveFor: a stub-only group follows mergedInto; a missing target gives a create', () => {
  const winner = shared('winnerAA1', 'https://ex.com/other', 1);
  const stub = shared('stubAAAA1', 'https://ex.com/b', 2, { mergedInto: 'winnerAA1' });
  assert.equal((deriveFor(buildIndex([winner, stub]), 'https://ex.com/b', 'itemAAAA1') as { id: string }).id, 'winnerAA1');

  const orphan = shared('stubAAAA2', 'https://ex.com/c', 2, { mergedInto: 'missingA1' });
  assert.deepEqual(deriveFor(buildIndex([orphan]), 'https://ex.com/c', 'itemAAAA1'), {
    kind: 'create',
    id: 'itemAAAA1',
    normalizedUrl: normalizeUrl('https://ex.com/c'),
  });
});

test('planAll: one new URL saved by two users gives one create and one link', () => {
  const plan = planAll(
    [],
    [
      user([article('itemBBBB1', 'https://ex.com/new')], [], 'userB'),
      user([article('itemAAAA1', 'https://ex.com/new?utm_source=y')], [], 'userA'),
    ],
  );
  assert.equal(plan.creates.length, 1);
  assert.equal(plan.creates[0]!.itemId, 'itemAAAA1');
  assert.equal(plan.creates[0]!.uidLabel, 'label-userA');
  assert.deepEqual(
    plan.linkChanges.map((c) => [c.uidLabel, c.itemId, c.to, c.kind]),
    [['label-userB', 'itemBBBB1', 'itemAAAA1', 'add']],
  );
  assert.deepEqual(plan.markerAdds.map((m) => [m.uidLabel, m.key, m.itemId]), [['label-userB', 'itemAAAA1', 'itemBBBB1']]);
});

test('planUser: an invalid id with no match gives none and clears an existing canonicalId', () => {
  const index = buildIndex([]);
  assert.deepEqual(deriveFor(index, 'https://ex.com/z', 'short01'), {
    kind: 'none',
    reason: 'invalid-id',
    normalizedUrl: normalizeUrl('https://ex.com/z'),
  });
  const plan = planUser(index, user([article('short01', 'https://ex.com/z', { canonicalId: 'sharedXXX1' })]));
  assert.equal(plan.creates.length, 0);
  assert.deepEqual(
    plan.linkChanges.map((c) => [c.itemId, c.from, c.to, c.kind]),
    [['short01', 'sharedXXX1', null, 'clear']],
  );
  assert.deepEqual(plan.anomalies.map((a) => a.kind), ['invalid-id']);
});

test('planUser: a deleted article gets no write, but its derived key keeps its marker', () => {
  const index = buildIndex([shared('sharedAAA1', 'https://ex.com/a', 1)]);
  const plan = planUser(
    index,
    user(
      [article('itemAAAA1', 'https://ex.com/a', { deleted: true, resolvedId: 'foreignAA1' })],
      [
        { key: 'sharedAAA1', source: 'sync', itemId: 'itemAAAA1' },
        { key: 'foreignAA1', source: 'sync', itemId: 'itemAAAA1' },
      ],
    ),
  );
  assert.equal(plan.skippedDeleted, 1);
  assert.equal(plan.articles, 0);
  assert.deepEqual(plan.linkChanges, []);
  assert.deepEqual(plan.creates, []);
  assert.deepEqual(plan.markerAdds, []);
  assert.deepEqual(plan.markerChanges, []);
  assert.deepEqual(plan.markerRemovals.map((m) => m.key), ['foreignAA1']);
});

test('planUser: a marker for a foreign id with source trigger is removed', () => {
  const plan = planUser(buildIndex([]), user([], [{ key: 'foreignAA2', source: 'trigger', itemId: 'nothing01' }]));
  assert.deepEqual(
    plan.markerRemovals.map((m) => [m.key, m.source, m.itemId]),
    [['foreignAA2', 'trigger', 'nothing01']],
  );
});

test('planUser: a legacy sync marker at the derived key becomes a marker change', () => {
  const index = buildIndex([shared('sharedAAA1', 'https://ex.com/a', 1)]);
  const plan = planUser(
    index,
    user(
      [article('itemAAAA1', 'https://ex.com/a', { canonicalId: 'sharedAAA1' })],
      [{ key: 'sharedAAA1', source: 'sync', itemId: 'itemAAAA1' }],
    ),
  );
  assert.deepEqual(plan.linkChanges, []);
  assert.deepEqual(plan.markerAdds, []);
  assert.deepEqual(
    plan.markerChanges.map((m) => [m.key, m.itemId, m.fromSource]),
    [['sharedAAA1', 'itemAAAA1', 'sync']],
  );
});

test('planUser: the marker itemId is the smallest linked article id', () => {
  const index = buildIndex([shared('sharedAAA1', 'https://ex.com/a', 1)]);
  const plan = planUser(
    index,
    user([article('itemZZZZ9', 'https://ex.com/a'), article('itemAAAA2', 'https://ex.com/a?utm_source=q')]),
  );
  assert.deepEqual(plan.markerAdds.map((m) => [m.key, m.itemId]), [['sharedAAA1', 'itemAAAA2']]);
  assert.equal(plan.linkChanges.length, 2);
});

test('planAll: a converged state plans zero writes', () => {
  const docs = [shared('sharedAAA1', 'https://ex.com/a', 1), shared('itemAAAA2', 'https://ex.com/b', 2)];
  const plan = planAll(docs, [
    user(
      [
        article('itemAAAA1', 'https://ex.com/a', { canonicalId: 'sharedAAA1' }),
        article('itemAAAA2', 'https://ex.com/b', { canonicalId: 'itemAAAA2' }),
      ],
      [
        { key: 'sharedAAA1', source: REDERIVE_MARKER_SOURCE, itemId: 'itemAAAA1' },
        { key: 'itemAAAA2', source: TRIGGER_MARKER_SOURCE, itemId: 'itemAAAA2' },
      ],
    ),
  ]);
  assert.deepEqual(
    [plan.creates, plan.linkChanges, plan.markerAdds, plan.markerChanges, plan.markerRemovals].map((l) => l.length),
    [0, 0, 0, 0, 0],
  );
});

test('checkPreconditions: detects a stale normalizedUrl, two unmerged docs and a bad stub', () => {
  assert.deepEqual(checkPreconditions([shared('sharedAAA1', 'https://ex.com/a', 1)]), []);

  const stale = { ...shared('sharedAAA1', 'https://ex.com/a', 1), normalizedUrl: undefined };
  assert.equal(checkPreconditions([stale]).length, 1);

  const twins = checkPreconditions([shared('sharedAAA1', 'https://ex.com/a', 1), shared('sharedAAA2', 'https://ex.com/a?utm_source=x', 2)]);
  assert.equal(twins.length, 1);
  assert.match(twins[0]!, /2 unmerged/);

  const winner = shared('winnerAA1', 'https://ex.com/w', 1, { mergedInto: 'otherAAA1' });
  const badStub = checkPreconditions([shared('stubAAAA1', 'https://ex.com/s', 2, { mergedInto: 'missingA1' }), winner]);
  assert.equal(badStub.filter((f) => /merged into/.test(f)).length, 2);
});

test('archiveLoss: flagged only when the old target had a success archive and the new one has none', () => {
  const docs = [
    shared('sharedAAA1', 'https://ex.com/a', 1),
    shared('oldWithArc', 'https://ex.com/old', 1, { hasSuccessArchive: true }),
    shared('sharedBBB1', 'https://ex.com/b', 1, { hasSuccessArchive: true }),
  ];
  const plan = planUser(
    buildIndex(docs),
    user([
      article('itemAAAA1', 'https://ex.com/a', { resolvedId: 'oldWithArc' }),
      article('itemAAAA2', 'https://ex.com/b', { resolvedId: 'oldWithArc' }),
      article('itemAAAA3', 'https://ex.com/new', { resolvedId: 'oldWithArc' }),
      article('itemAAAA4', 'https://ex.com/a', { resolvedId: 'sharedBBB0' }),
    ]),
  );
  assert.deepEqual(
    plan.linkChanges.map((c) => [c.itemId, c.archiveLoss]),
    [
      ['itemAAAA1', true],
      ['itemAAAA2', false],
      ['itemAAAA4', false],
    ],
  );
  assert.deepEqual(plan.creates.map((c) => [c.itemId, c.archiveLoss]), [['itemAAAA3', true]]);
});

test('SERVER_MARKER_SOURCES holds the merge and trigger sources', () => {
  assert.ok(SERVER_MARKER_SOURCES.has(MERGE_MARKER_SOURCE));
  assert.ok(SERVER_MARKER_SOURCES.has(TRIGGER_MARKER_SOURCE));
  assert.ok(SERVER_MARKER_SOURCES.has(REDERIVE_MARKER_SOURCE));
});

test('isDeleted: deletedAt or the legacy deleted_at, when non-null', () => {
  assert.equal(isDeleted({}), false);
  assert.equal(isDeleted({ deletedAt: null }), false);
  assert.equal(isDeleted({ deletedAt: 5 }), true);
  assert.equal(isDeleted({ deleted_at: 5 }), true);
});

test('planUser: an id conflict removes the itemId marker and flags the archive loss', () => {
  // articles/itemAAAA1 holds another URL; nothing proves it is this user's own.
  const index = buildIndex([shared('itemAAAA1', 'https://ex.com/first', 1, { hasSuccessArchive: true })]);
  const plan = planUser(
    index,
    user([article('itemAAAA1', 'https://ex.com/second')], [{ key: 'itemAAAA1', source: 'sync', itemId: 'itemAAAA1' }]),
  );
  assert.deepEqual(plan.anomalies.map((a) => a.kind), ['id-conflict']);
  assert.deepEqual(plan.markerRemovals.map((m) => [m.key, m.archiveLoss]), [['itemAAAA1', true]]);
  assert.deepEqual(plan.creates, []);
});

test('planUser: an item id chosen to collide with another user\'s shared article loses its marker', () => {
  // userB saved https://ex.com/victim as articles/victimAA1; userA saves another
  // URL under the same item id and writes a marker for it.
  const index = buildIndex([shared('victimAA1', 'https://ex.com/victim', 1)]);
  const plan = planUser(
    index,
    user([article('victimAA1', 'https://ex.com/other')], [{ key: 'victimAA1', source: 'trigger', itemId: 'victimAA1' }]),
  );
  assert.deepEqual(plan.anomalies.map((a) => a.kind), ['id-conflict']);
  assert.deepEqual(plan.markerRemovals.map((m) => m.key), ['victimAA1']);
  assert.deepEqual(plan.markerAdds, []);
});

test('planUser: an invalid id keeps a marker keyed by that id', () => {
  const plan = planUser(
    buildIndex([]),
    user([article('short01', 'https://ex.com/z')], [{ key: 'short01', source: 'sync', itemId: 'short01' }]),
  );
  assert.deepEqual(plan.anomalies.map((a) => a.kind), ['invalid-id']);
  assert.deepEqual(plan.markerRemovals, []);
});

test('planUser: a removed marker on a shared article with a finished archive is flagged archiveLoss', () => {
  const index = buildIndex([
    shared('foreignAA3', 'https://ex.com/f', 1, { hasSuccessArchive: true }),
    shared('foreignAA4', 'https://ex.com/g', 1),
  ]);
  const plan = planUser(
    index,
    user(
      [],
      [
        { key: 'foreignAA3', source: 'sync', itemId: 'nothing01' },
        { key: 'foreignAA4', source: 'sync', itemId: 'nothing01' },
      ],
    ),
  );
  assert.deepEqual(
    plan.markerRemovals.map((m) => [m.key, m.archiveLoss]),
    [
      ['foreignAA3', true],
      ['foreignAA4', false],
    ],
  );
});
