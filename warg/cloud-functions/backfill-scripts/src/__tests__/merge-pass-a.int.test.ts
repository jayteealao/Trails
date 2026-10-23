import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { normalizeUrl } from '@warg/url-normalizer';
import { Timestamp } from 'firebase-admin/firestore';
import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { markersCollection, sharedArticlesCollection, userArticlesCollection } from '../articles.js';
import { MERGE_MARKER_SOURCE, runCli, runMergePassA } from '../merge-pass-a.js';
import type { MergeReport, MergeResult } from '../merge-pass-a.js';
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

let testDb: TestDb;
let db: Firestore;
let reportDir: string;

beforeAll(async () => {
  testDb = createTestDb();
  db = testDb.db;
  reportDir = await mkdtemp(join(tmpdir(), 'merge-pass-a-'));
});

afterAll(async () => {
  await destroyTestDb(testDb);
  await rm(reportDir, { recursive: true, force: true });
});

afterEach(async () => {
  await clearEmulator();
});

/**
 * Three duplicate groups and one singleton.
 * G1: the older doc has no archive; the newer (utm variant) has readability.
 * G2: oldest has readability; middle (fbclid) has pdf + an uploading screenshot;
 *     youngest (fragment) has pdf.
 * G3: g3b has no created_at, so its create time (now) beats g3a's 2030 date.
 */
async function seed(): Promise<void> {
  const shared = sharedArticlesCollection(db);
  await shared.doc('g1old').set({
    url: 'https://news.example.com/g1',
    created_at: at('2020-01-01T00:00:00Z'),
    archives: {},
  });
  await shared.doc('g1new').set({
    url: 'https://news.example.com/g1?utm_source=x',
    created_at: at('2021-01-01T00:00:00Z'),
    archives: { readability: success('g1new/readability.html') },
  });
  await shared.doc('g2old').set({
    url: 'https://blog.example.org/g2',
    created_at: at('2020-02-01T00:00:00Z'),
    archives: { readability: success('g2old/readability.html') },
  });
  await shared.doc('g2mid').set({
    url: 'https://blog.example.org/g2?fbclid=abc',
    created_at: at('2020-06-01T00:00:00Z'),
    archives: {
      pdf: success('g2mid/page.pdf'),
      screenshot: { status: 'uploading', gcs_path: 'gs://test-bucket/g2mid/shot.png' },
    },
  });
  await shared.doc('g2young').set({
    url: 'https://blog.example.org/g2#section',
    created_at: at('2021-06-01T00:00:00Z'),
    archives: { pdf: success('g2young/page.pdf') },
  });
  await shared.doc('g3a').set({
    url: 'https://site.example.net/g3/',
    created_at: at('2030-01-01T00:00:00Z'),
  });
  await shared.doc('g3b').set({ url: 'https://site.example.net/g3' });
  await shared.doc('s1').set({
    url: 'https://solo.example.com/s1',
    created_at: at('2022-01-01T00:00:00Z'),
  });

  await userArticlesCollection(db, USER_A).doc('a-g1').set({ itemId: 'a-g1', resolvedId: 'g1new' });
  await userArticlesCollection(db, USER_A).doc('a-g2').set({ itemId: 'a-g2', canonicalId: 'g2young' });
  await userArticlesCollection(db, USER_A).doc('a-solo').set({ itemId: 'a-solo', resolvedId: 's1' });
  await userArticlesCollection(db, USER_B).doc('g2mid').set({ itemId: 'g2mid' });
  await markersCollection(db, USER_B).doc('g2mid').set({ key: 'g2mid', itemId: 'g2mid', source: 'sync' });
}

interface DocState {
  readonly data: DocumentData;
  readonly updateTime: string;
}

/** Every document the pass may touch, by path. */
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
      state.set(doc.ref.path, { data: doc.data(), updateTime: doc.updateTime.toDate().toISOString() });
    }
  }
  return state;
}

/** Document data without the server-set marker time, for comparing two runs. */
async function comparableState(): Promise<Record<string, DocumentData>> {
  const out: Record<string, DocumentData> = {};
  for (const [path, { data }] of await snapshotAll()) {
    const { createdAt: _createdAt, ...rest } = data;
    out[path] = path.includes('/articleMarkers/') ? rest : data;
  }
  return out;
}

async function shared(id: string): Promise<DocumentData> {
  const snap = await sharedArticlesCollection(db).doc(id).get();
  expect(snap.exists).toBe(true);
  return snap.data()!;
}

function reportPath(name: string): string {
  return join(reportDir, `${name}.json`);
}

function plannedWrites(result: MergeResult): number {
  const { counts } = result.report;
  return (
    counts.archiveCopies +
    counts.linkMoves +
    counts.markerAdds +
    counts.stubWrites +
    counts.normalizedUrlWrites
  );
}

describe('duplicate merge (emulator)', () => {
  it('dry run writes nothing and the report lists every planned change', async () => {
    await seed();
    const before = await snapshotAll();
    const path = reportPath('dry-run');

    const { result, reportPath: written } = await runCli(['--report', path], db);

    expect(written).toBe(path);
    expect(await snapshotAll()).toEqual(before);

    const text = await readFile(path, 'utf8');
    const report = JSON.parse(text) as MergeReport;
    expect(report.mode).toBe('dry-run');
    expect(report.target).toBe('emulator');
    expect(report.counts).toEqual({
      sharedArticles: 8,
      groups: 3,
      losers: 4,
      archiveCopies: 2,
      linkMoves: 3,
      markerAdds: 3,
      stubWrites: 4,
      normalizedUrlWrites: 8,
      anomalies: 0,
      errors: 0,
    });
    expect(result.report).toEqual(report);

    const groups = Object.fromEntries(report.groups.map((group) => [group.winner.id, group]));
    expect(Object.keys(groups).sort()).toEqual(['g1old', 'g2old', 'g3b']);
    expect(groups['g1old']!.archiveCopies).toEqual([{ key: 'readability', fromId: 'g1new' }]);
    expect(groups['g2old']!.archiveCopies).toEqual([{ key: 'pdf', fromId: 'g2mid' }]);
    expect(groups['g2old']!.stubWrites).toEqual(['g2mid', 'g2young']);
    expect(groups['g3b']!.stubWrites).toEqual(['g3a']);

    const labelA = userLabel(USER_A);
    const labelB = userLabel(USER_B);
    expect(report.linkMoves).toEqual(
      expect.arrayContaining([
        { user: labelA, itemId: 'a-g1', from: 'g1new', to: 'g1old' },
        { user: labelA, itemId: 'a-g2', from: 'g2young', to: 'g2old' },
        { user: labelB, itemId: 'g2mid', from: 'g2mid', to: 'g2old' },
      ]),
    );
    expect(report.markerAdds).toEqual(
      expect.arrayContaining([
        { user: labelA, key: 'g1old', itemId: 'a-g1' },
        { user: labelA, key: 'g2old', itemId: 'a-g2' },
        { user: labelB, key: 'g2old', itemId: 'g2mid' },
      ]),
    );
    expect(report.normalizedUrlWrites.map((write) => write.id).sort()).toEqual(
      ['g1new', 'g1old', 'g2mid', 'g2old', 'g2young', 'g3a', 'g3b', 's1'],
    );

    // Users appear only as hashed labels.
    expect(text).not.toContain(USER_A);
    expect(text).not.toContain(USER_B);
    expect(text).toContain(labelA);
  });

  it('real run: oldest wins, archives and links move, losers become stubs', async () => {
    await seed();

    const { result } = await runCli(['--apply', '--page-size', '2', '--report', reportPath('apply')], db);
    expect(result.errors).toBe(0);
    expect(result.report.mode).toBe('apply');

    // G1: the older doc wins and takes the newer doc's readability archive.
    const g1old = await shared('g1old');
    expect(g1old['archives']).toEqual({ readability: success('g1new/readability.html') });
    expect(g1old['mergedInto']).toBeUndefined();

    // G2: pdf comes from the middle doc (oldest loser with one); the uploading screenshot stays put.
    const g2old = await shared('g2old');
    expect(g2old['archives']).toEqual({
      readability: success('g2old/readability.html'),
      pdf: success('g2mid/page.pdf'),
    });

    // G3: the doc without created_at wins on its create time.
    expect((await shared('g3b'))['mergedInto']).toBeUndefined();

    // Each loser still exists, keeps its own archives, and points at its winner.
    const losers: Record<string, string> = { g1new: 'g1old', g2mid: 'g2old', g2young: 'g2old', g3a: 'g3b' };
    for (const [loserId, winnerId] of Object.entries(losers)) {
      const loser = await shared(loserId);
      expect(loser['mergedInto']).toBe(winnerId);
    }
    expect((await shared('g2mid'))['archives']).toHaveProperty('screenshot');
    expect((await shared('g2young'))['archives']).toEqual({ pdf: success('g2young/page.pdf') });

    // Every shared doc, the singleton included, has normalizedUrl.
    const all = await sharedArticlesCollection(db).get();
    expect(all.size).toBe(8);
    for (const doc of all.docs) {
      expect(doc.get('normalizedUrl')).toBe(normalizeUrl(doc.get('url') as string));
    }

    // Linked user articles name the winner, with a merge marker for it.
    const links: Array<[string, string, string]> = [
      [USER_A, 'a-g1', 'g1old'],
      [USER_A, 'a-g2', 'g2old'],
      [USER_B, 'g2mid', 'g2old'],
    ];
    for (const [uid, itemId, winnerId] of links) {
      const articleSnap = await userArticlesCollection(db, uid).doc(itemId).get();
      expect(articleSnap.get('canonicalId')).toBe(winnerId);
      const marker = await markersCollection(db, uid).doc(winnerId).get();
      expect(marker.exists).toBe(true);
      expect(marker.get('itemId')).toBe(itemId);
      expect(marker.get('source')).toBe(MERGE_MARKER_SOURCE);
    }
    // resolvedId is never written; the article on the singleton is untouched.
    expect((await userArticlesCollection(db, USER_A).doc('a-g1').get()).get('resolvedId')).toBe('g1new');
    expect((await userArticlesCollection(db, USER_A).doc('a-solo').get()).get('canonicalId')).toBeUndefined();

    // userB's marker for the loser is kept (this pass deletes nothing).
    const loserMarker = await markersCollection(db, USER_B).doc('g2mid').get();
    expect(loserMarker.exists).toBe(true);
    expect(loserMarker.get('source')).toBe('sync');
  });

  it('a second real run makes no change', async () => {
    await seed();
    await runCli(['--apply', '--report', reportPath('first')], db);
    const before = await snapshotAll();

    const { result } = await runCli(['--apply', '--report', reportPath('second')], db);

    expect(plannedWrites(result)).toBe(0);
    expect(result.errors).toBe(0);
    expect(await snapshotAll()).toEqual(before);
  });

  it('a run stopped before the stub writes is finished by the next run', async () => {
    await seed();
    await runMergePassA(db, { apply: true });
    const oneShot = await comparableState();

    await clearEmulator();
    await seed();
    const partial = await runMergePassA(db, { apply: true, stopAfterPhase: 2 });
    expect(partial.errors).toBe(0);
    expect((await shared('g1new'))['mergedInto']).toBeUndefined();

    const resumed = await runMergePassA(db, { apply: true });
    expect(resumed.report.counts.stubWrites).toBe(4);
    expect(resumed.report.counts.linkMoves).toBe(0);
    expect(await comparableState()).toEqual(oneShot);
  });

  it('writes every winner marker before any user link moves', async () => {
    await seed();
    await runMergePassA(db, { apply: true });
    const oneShot = await comparableState();

    await clearEmulator();
    await seed();
    const planned = await runMergePassA(db, { apply: false });
    expect(planned.markerAdds.length).toBeGreaterThan(0);
    expect(planned.linkMoves.length).toBeGreaterThan(0);
    const linkBefore = new Map<string, unknown>();
    for (const move of planned.linkMoves) {
      const snap = await userArticlesCollection(db, move.uid).doc(move.itemId).get();
      linkBefore.set(`${move.uid}/${move.itemId}`, snap.get('canonicalId'));
    }

    const seen: { markers: Array<[string, string, unknown]>; links: Array<[string, unknown]> } = {
      markers: [],
      links: [],
    };
    const result = await runMergePassA(db, {
      apply: true,
      afterMarkers: async () => {
        for (const add of planned.markerAdds) {
          const marker = await markersCollection(db, add.uid).doc(add.key).get();
          seen.markers.push([add.uid, add.key, marker.exists ? marker.get('source') : undefined]);
        }
        for (const move of planned.linkMoves) {
          const snap = await userArticlesCollection(db, move.uid).doc(move.itemId).get();
          seen.links.push([`${move.uid}/${move.itemId}`, snap.get('canonicalId')]);
        }
      },
    });
    expect(result.errors).toBe(0);

    // Between the two flushes: every planned winner marker exists, and no link has moved yet.
    expect(seen.markers).toHaveLength(planned.markerAdds.length);
    expect(seen.markers).toEqual(
      expect.arrayContaining([
        [USER_A, 'g1old', MERGE_MARKER_SOURCE],
        [USER_A, 'g2old', MERGE_MARKER_SOURCE],
        [USER_B, 'g2old', MERGE_MARKER_SOURCE],
      ]),
    );
    for (const [, , source] of seen.markers) expect(source).toBe(MERGE_MARKER_SOURCE);
    expect(seen.links).toHaveLength(planned.linkMoves.length);
    for (const [path, link] of seen.links) expect(link).toBe(linkBefore.get(path));
    expect(linkBefore.get(`${USER_A}/a-g2`)).toBe('g2young');
    expect(linkBefore.get(`${USER_A}/a-g1`)).toBeUndefined();
    expect(linkBefore.get(`${USER_B}/g2mid`)).toBeUndefined();

    expect(await comparableState()).toEqual(oneShot);
  });

  it('adds a missing winner marker for an article already linked to the winner', async () => {
    await seed();
    await userArticlesCollection(db, USER_B).doc('b-g1').set({ itemId: 'b-g1', canonicalId: 'g1old' });

    const result = await runMergePassA(db, { apply: true });

    expect(result.markerAdds).toEqual(
      expect.arrayContaining([expect.objectContaining({ uid: USER_B, key: 'g1old', itemId: 'b-g1' })]),
    );
    const marker = await markersCollection(db, USER_B).doc('g1old').get();
    expect(marker.get('source')).toBe(MERGE_MARKER_SOURCE);
  });
});
