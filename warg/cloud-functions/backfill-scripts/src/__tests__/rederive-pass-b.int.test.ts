import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

import { normalizeUrl } from '@warg/url-normalizer';
import { Timestamp } from 'firebase-admin/firestore';
import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { markersCollection, sharedArticlesCollection, userArticlesCollection } from '../articles.js';
import { MERGE_MARKER_SOURCE, runMergePassA } from '../merge-pass-a.js';
import { REDERIVE_MARKER_SOURCE } from '../rederive.js';
import { runCli, runRederivePassB } from '../rederive-pass-b.js';
import type { RederiveReport, RederiveResult } from '../rederive-pass-b.js';
import { userLabel } from '../report.js';
import { clearEmulator, createTestDb, destroyTestDb } from './emulator.js';
import type { TestDb } from './emulator.js';

const USER_A = 'userA';
const USER_B = 'userB';

const success = (path: string): Record<string, unknown> => ({
  status: 'success',
  gcs_path: `gs://test-bucket/${path}`,
  gcs_bucket: 'test-bucket',
});
const at = (iso: string): Timestamp => Timestamp.fromDate(new Date(iso));

const URL_ALIAS_1 = 'https://ex.com/a?utm_source=x';
const URL_GIVEN = 'https://ex.com/given';
const URL_SHORT = 'https://ex.com/short-new';
const URL_DUP_LATE = 'https://ex.com/dup?fbclid=z';

let testDb: TestDb;
let db: Firestore;
let reportDir: string;

beforeAll(async () => {
  testDb = createTestDb();
  db = testDb.db;
  reportDir = await mkdtemp(join(tmpdir(), 'rederive-pass-b-'));
});

afterAll(async () => {
  await destroyTestDb(testDb);
  await rm(reportDir, { recursive: true, force: true });
});

afterEach(async () => {
  // runCli sets the exit code for a refused or partial run; it is asserted per test.
  process.exitCode = 0;
  await clearEmulator();
});

/** The shared articles and the two users, before the duplicate merge. */
async function seedBeforeMerge(): Promise<void> {
  const shared = sharedArticlesCollection(db);
  await shared.doc('sharedPocket01').set({
    url: 'https://ex.com/a',
    created_at: at('2020-01-01T00:00:00Z'),
    archives: {},
  });
  await shared.doc('sharedOther01').set({
    url: 'https://ex.com/resolved',
    created_at: at('2020-02-01T00:00:00Z'),
    archives: { readability: success('sharedOther01/readability.html') },
  });
  await shared.doc('dupOld0001').set({
    url: 'https://ex.com/dup',
    created_at: at('2020-03-01T00:00:00Z'),
    archives: {},
  });
  await shared.doc('dupNew0001').set({
    url: 'https://ex.com/dup?utm_source=y',
    created_at: at('2021-01-01T00:00:00Z'),
    archives: {},
  });
  await shared.doc('foreign0001').set({ url: 'https://ex.com/foreign', created_at: at('2020-04-01T00:00:00Z') });
  await shared.doc('foreign0002').set({ url: 'https://ex.com/foreign-2', created_at: at('2020-05-01T00:00:00Z') });

  const articlesA = userArticlesCollection(db, USER_A);
  // Pocket alias whose URL matches its alias: only the app marker is legacy.
  await articlesA.doc('aliasA0001').set({ itemId: 'aliasA0001', url: URL_ALIAS_1, resolvedId: 'sharedPocket01' });
  // Pocket alias whose URL matches nothing; the client also wrote canonicalId.
  await articlesA.doc('aliasA0002').set({
    itemId: 'aliasA0002',
    url: URL_GIVEN,
    resolvedId: 'sharedOther01',
    canonicalId: 'sharedOther01',
  });
  // An id too short for a shared article, with a client-written link.
  await articlesA.doc('short01').set({ itemId: 'short01', url: URL_SHORT, canonicalId: 'sharedPocket01' });
  const markersA = markersCollection(db, USER_A);
  await markersA.doc('sharedPocket01').set({ key: 'sharedPocket01', itemId: 'aliasA0001', source: 'sync' });
  await markersA.doc('sharedOther01').set({ key: 'sharedOther01', itemId: 'aliasA0002', source: 'sync' });
  // Forged: a server source on a marker no own URL derives.
  await markersA.doc('foreign0002').set({ key: 'foreign0002', itemId: 'aliasA0001', source: 'trigger' });

  const articlesB = userArticlesCollection(db, USER_B);
  // Linked to the loser; the merge moves it to the winner.
  await articlesB.doc('itemB00001').set({ itemId: 'itemB00001', url: 'https://ex.com/dup', resolvedId: 'dupNew0001' });
  // Deleted, linked to and marked for another user's shared article.
  await articlesB.doc('itemB00003').set({
    itemId: 'itemB00003',
    url: 'https://ex.com/deleted-own',
    resolvedId: 'foreign0001',
    deletedAt: at('2026-01-01T00:00:00Z'),
  });
  await markersCollection(db, USER_B)
    .doc('foreign0001')
    .set({ key: 'foreign0001', itemId: 'itemB00003', source: 'sync' });
}

/** The full fixture: the merge ran, then userB saved one more link to the loser. */
async function seed(): Promise<void> {
  await seedBeforeMerge();
  const merge = await runMergePassA(db, { apply: true });
  expect(merge.errors).toBe(0);

  await userArticlesCollection(db, USER_B)
    .doc('itemB00002')
    .set({ itemId: 'itemB00002', url: URL_DUP_LATE, resolvedId: 'dupNew0001' });
  await markersCollection(db, USER_B)
    .doc('dupNew0001')
    .set({ key: 'dupNew0001', itemId: 'itemB00002', source: 'sync' });
}

interface DocState {
  readonly data: DocumentData;
  readonly updateTime: string;
}

/** Every document the pass may touch, by path, with its exact update time. */
async function snapshotAll(): Promise<Map<string, DocState>> {
  const collections = [
    sharedArticlesCollection(db),
    userArticlesCollection(db, USER_A),
    userArticlesCollection(db, USER_B),
    markersCollection(db, USER_A),
    markersCollection(db, USER_B),
  ];
  const state = new Map<string, DocState>();
  for (const collection of collections) {
    const snapshot = await collection.get();
    for (const doc of snapshot.docs) {
      const { seconds, nanoseconds } = doc.updateTime;
      state.set(doc.ref.path, { data: doc.data(), updateTime: `${seconds}.${nanoseconds}` });
    }
  }
  return state;
}

/** Replace every timestamp with a placeholder, so runs at different times compare equal. */
function withoutTimes(value: unknown): unknown {
  if (value instanceof Timestamp) return 'timestamp';
  if (Array.isArray(value)) return value.map(withoutTimes);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, withoutTimes(inner)]));
  }
  return value;
}

async function comparableState(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [path, { data }] of await snapshotAll()) out[path] = withoutTimes(data);
  return out;
}

async function userArticle(uid: string, itemId: string): Promise<DocumentData> {
  const snap = await userArticlesCollection(db, uid).doc(itemId).get();
  expect(snap.exists).toBe(true);
  return snap.data()!;
}

async function markerIds(uid: string): Promise<string[]> {
  const snapshot = await markersCollection(db, uid).get();
  return snapshot.docs.map((doc) => doc.id).sort();
}

function reportPath(name: string): string {
  return join(reportDir, `${name}.json`);
}

function plannedWrites(result: RederiveResult): number {
  const { counts } = result.report;
  return (
    counts.linkAdds +
    counts.linkChanges +
    counts.linkClears +
    counts.creates +
    counts.markerAdds +
    counts.markerChanges +
    counts.markerRemovals
  );
}

describe('link re-derive (emulator)', () => {
  it('dry run writes nothing and the report lists every planned change', async () => {
    await seed();
    const before = await snapshotAll();
    const path = reportPath('dry-run');

    const { result, reportPath: written, exitCode } = await runCli(['--report', path], db);

    expect(exitCode).toBe(0);
    expect(written).toBe(path);
    expect(await snapshotAll()).toEqual(before);

    const text = await readFile(path, 'utf8');
    const report = JSON.parse(text) as RederiveReport;
    expect(result.report).toEqual(report);
    expect(report.mode).toBe('dry-run');
    expect(report.target).toBe('emulator');
    expect(report.preconditionFailures).toEqual([]);
    expect(report.counts).toEqual({
      users: 2,
      articles: 5,
      skippedDeleted: 1,
      linkAdds: 2,
      linkChanges: 0,
      linkClears: 1,
      creates: 1,
      archiveLoss: 1,
      markerAdds: 0,
      markerChanges: 1,
      markerRemovals: 4,
      anomalies: 1,
      conflicts: 0,
      errors: 0,
    });

    const labelA = userLabel(USER_A);
    const labelB = userLabel(USER_B);
    expect(report.linkChanges).toEqual(
      expect.arrayContaining([
        {
          uidLabel: labelA,
          itemId: 'aliasA0001',
          normalizedUrl: normalizeUrl(URL_ALIAS_1),
          from: 'sharedPocket01',
          to: 'sharedPocket01',
          kind: 'add',
          archiveLoss: false,
        },
        {
          uidLabel: labelA,
          itemId: 'short01',
          normalizedUrl: normalizeUrl(URL_SHORT),
          from: 'sharedPocket01',
          to: null,
          kind: 'clear',
          archiveLoss: false,
        },
        {
          uidLabel: labelB,
          itemId: 'itemB00002',
          normalizedUrl: normalizeUrl(URL_DUP_LATE),
          from: 'dupNew0001',
          to: 'dupOld0001',
          kind: 'add',
          archiveLoss: false,
        },
      ]),
    );
    expect(report.creates).toEqual([
      {
        uidLabel: labelA,
        itemId: 'aliasA0002',
        normalizedUrl: normalizeUrl(URL_GIVEN),
        from: 'sharedOther01',
        archiveLoss: true,
      },
    ]);
    expect(report.markerAdds).toEqual([]);
    expect(report.markerChanges).toEqual([
      { uidLabel: labelA, key: 'sharedPocket01', itemId: 'aliasA0001', fromSource: 'sync' },
    ]);
    expect(report.markerRemovals).toEqual(
      expect.arrayContaining([
        { uidLabel: labelA, key: 'foreign0002', source: 'trigger', itemId: 'aliasA0001' },
        { uidLabel: labelA, key: 'sharedOther01', source: 'sync', itemId: 'aliasA0002' },
        { uidLabel: labelB, key: 'dupNew0001', source: 'sync', itemId: 'itemB00002' },
        { uidLabel: labelB, key: 'foreign0001', source: 'sync', itemId: 'itemB00003' },
      ]),
    );
    expect(report.anomalies).toEqual([
      { kind: 'invalid-id', uidLabel: labelA, itemId: 'short01', normalizedUrl: normalizeUrl(URL_SHORT) },
    ]);

    // Users appear only as hashed labels.
    expect(text).not.toContain(USER_A);
    expect(text).not.toContain(USER_B);
    expect(text).toContain(labelA);
  });

  it('real run: every live article gets a server link and marker; the deleted one is untouched', async () => {
    await seed();
    const before = await snapshotAll();

    const { result, exitCode } = await runCli(['--apply', '--page-size', '2', '--report', reportPath('apply')], db);
    expect(exitCode).toBe(0);
    expect(result.errors).toBe(0);
    expect(result.conflicts).toEqual([]);
    expect(result.report.mode).toBe('apply');

    // Each live article names the shared article its URL derives, with a server marker for it.
    const links: Array<[string, string, string, string]> = [
      [USER_A, 'aliasA0001', 'sharedPocket01', REDERIVE_MARKER_SOURCE],
      [USER_A, 'aliasA0002', 'aliasA0002', REDERIVE_MARKER_SOURCE],
      [USER_B, 'itemB00001', 'dupOld0001', MERGE_MARKER_SOURCE],
      [USER_B, 'itemB00002', 'dupOld0001', MERGE_MARKER_SOURCE],
    ];
    for (const [uid, itemId, sharedId, source] of links) {
      expect((await userArticle(uid, itemId))['canonicalId']).toBe(sharedId);
      const marker = await markersCollection(db, uid).doc(sharedId).get();
      expect(marker.exists).toBe(true);
      expect(marker.get('source')).toBe(source);
    }
    // The pass writes resolvedId with canonicalId (the merge moved itemB00001 already).
    expect((await userArticle(USER_A, 'aliasA0001'))['resolvedId']).toBe('sharedPocket01');
    expect((await userArticle(USER_A, 'aliasA0002'))['resolvedId']).toBe('aliasA0002');
    expect((await userArticle(USER_B, 'itemB00002'))['resolvedId']).toBe('dupOld0001');

    // The legacy app marker became a server marker; the merge marker stayed.
    const pocketMarker = await markersCollection(db, USER_A).doc('sharedPocket01').get();
    expect(pocketMarker.get('itemId')).toBe('aliasA0001');
    expect((await markersCollection(db, USER_B).doc('dupOld0001').get()).get('itemId')).toBe('itemB00001');

    // The unmatched alias got a new shared article of its own, with no archive yet.
    const created = await sharedArticlesCollection(db).doc('aliasA0002').get();
    expect(created.exists).toBe(true);
    expect(created.get('normalizedUrl')).toBe(normalizeUrl(URL_GIVEN));
    expect(created.get('status')).toBe('pending');
    expect(created.get('archives')).toEqual({});

    // Markers no own URL derives are gone.
    expect(await markerIds(USER_A)).toEqual(['aliasA0002', 'sharedPocket01']);
    expect(await markerIds(USER_B)).toEqual(['dupOld0001']);

    // The short id has no link and is reported.
    expect((await userArticle(USER_A, 'short01'))['canonicalId']).toBeUndefined();
    expect(result.report.anomalies).toEqual([expect.objectContaining({ kind: 'invalid-id', itemId: 'short01' })]);

    const after = await snapshotAll();
    // The deleted article is unchanged, down to its update time.
    const deletedPath = userArticlesCollection(db, USER_B).doc('itemB00003').path;
    expect(after.get(deletedPath)).toEqual(before.get(deletedPath));
    // No shared article changed except the one created.
    for (const [path, state] of before) {
      if (path.startsWith('articles/')) expect(after.get(path)).toEqual(state);
    }
    const newShared = [...after.keys()].filter((path) => path.startsWith('articles/') && !before.has(path));
    expect(newShared).toEqual(['articles/aliasA0002']);
  });

  it('a second real run makes no change', async () => {
    await seed();
    await runCli(['--apply', '--report', reportPath('first')], db);
    const before = await snapshotAll();

    const { result, exitCode } = await runCli(['--apply', '--report', reportPath('second')], db);

    expect(exitCode).toBe(0);
    expect(plannedWrites(result)).toBe(0);
    expect(result.errors).toBe(0);
    expect(await snapshotAll()).toEqual(before);
  });

  it('a run stopped after phase 1 or 2 is finished by the next run', async () => {
    await seed();
    await runRederivePassB(db, { apply: true });
    const oneShot = await comparableState();

    await clearEmulator();
    await seed();
    const first = await runRederivePassB(db, { apply: true, stopAfterPhase: 1 });
    expect(first.errors).toBe(0);
    expect((await sharedArticlesCollection(db).doc('aliasA0002').get()).exists).toBe(true);
    expect((await userArticle(USER_A, 'aliasA0001'))['canonicalId']).toBeUndefined();

    const second = await runRederivePassB(db, { apply: true, stopAfterPhase: 2 });
    expect(second.errors).toBe(0);
    expect(second.report.counts.creates).toBe(0);
    expect((await userArticle(USER_A, 'aliasA0001'))['canonicalId']).toBe('sharedPocket01');
    expect(await markerIds(USER_A)).toContain('sharedOther01');

    const third = await runRederivePassB(db, { apply: true });
    expect(third.errors).toBe(0);
    expect(third.report.counts.markerRemovals).toBe(4);
    expect(third.report.counts.linkAdds + third.report.counts.linkClears).toBe(0);
    expect(await comparableState()).toEqual(oneShot);
  });

  it('refuses --apply until the duplicate merge has finished', async () => {
    await seedBeforeMerge();
    const before = await snapshotAll();
    const path = reportPath('refused');

    const { result, exitCode } = await runCli(['--apply', '--report', path], db);

    expect(exitCode).toBe(2);
    expect(result.refused).toBe(true);
    expect(await snapshotAll()).toEqual(before);
    const report = JSON.parse(await readFile(path, 'utf8')) as RederiveReport;
    expect(report.preconditionFailures.length).toBeGreaterThan(0);
    expect(report.preconditionFailures).toEqual(
      expect.arrayContaining([expect.stringContaining('2 unmerged shared articles: dupNew0001, dupOld0001')]),
    );
  });

  it('reports a document changed after the scan as a conflict, and a re-run converges', async () => {
    await seed();

    const { result, exitCode } = await runCli(['--apply', '--report', reportPath('conflict')], db, {
      beforePhase2: async () => {
        await userArticlesCollection(db, USER_A).doc('aliasA0001').update({ title: 'edited meanwhile' });
      },
    });

    expect(exitCode).toBe(1);
    expect(result.errors).toBe(0);
    expect(result.conflicts).toEqual([{ uidLabel: userLabel(USER_A), path: 'articles/aliasA0001', phase: 2 }]);
    const edited = await userArticle(USER_A, 'aliasA0001');
    expect(edited['title']).toBe('edited meanwhile');
    expect(edited['canonicalId']).toBeUndefined();

    const rerun = await runCli(['--apply', '--report', reportPath('conflict-rerun')], db);
    expect(rerun.exitCode).toBe(0);
    expect(rerun.result.conflicts).toEqual([]);
    expect((await userArticle(USER_A, 'aliasA0001'))['canonicalId']).toBe('sharedPocket01');

    const check = await runCli(['--report', reportPath('conflict-check')], db);
    expect(plannedWrites(check.result)).toBe(0);
  });
});
