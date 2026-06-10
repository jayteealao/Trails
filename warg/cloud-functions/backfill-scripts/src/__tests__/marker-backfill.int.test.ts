import type { Firestore } from 'firebase-admin/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { markersCollection, userArticlesCollection } from '../articles.js';
import { backfillMarkers } from '../marker-backfill.js';
import { clearEmulator, createTestDb, destroyTestDb } from './emulator.js';
import type { TestDb } from './emulator.js';

const USER = 'TEST_USER';

let testDb: TestDb;
let db: Firestore;

beforeAll(() => {
  testDb = createTestDb();
  db = testDb.db;
});

afterAll(async () => {
  await destroyTestDb(testDb);
});

afterEach(async () => {
  await clearEmulator();
});

async function seedArticle(
  itemId: string,
  fields: Record<string, unknown> = {},
): Promise<void> {
  await userArticlesCollection(db, USER).doc(itemId).set({ itemId, ...fields });
}

async function markerIds(): Promise<string[]> {
  const snapshot = await markersCollection(db, USER).get();
  return snapshot.docs.map((doc) => doc.id).sort();
}

describe('marker backfill (emulator)', () => {
  it('writes a marker for every derived key (itemId + distinct resolvedId)', async () => {
    await seedArticle('a1'); // itemId only
    await seedArticle('a2', { resolvedId: 'r2' }); // both keys
    await seedArticle('a3', { resolvedId: 'a3' }); // resolvedId == itemId -> itemId only

    const result = await backfillMarkers(db, {
      user: USER,
      apply: true,
      limit: Number.POSITIVE_INFINITY,
    });

    expect(result.articles).toBe(3);
    expect(result.written).toBe(4); // a1, a2, r2, a3
    expect(result.errors).toBe(0);
    expect(await markerIds()).toEqual(['a1', 'a2', 'a3', 'r2']);
  });

  it('is idempotent: a second run writes nothing', async () => {
    await seedArticle('a1', { resolvedId: 'r1' });
    await backfillMarkers(db, { user: USER, apply: true, limit: Number.POSITIVE_INFINITY });

    const second = await backfillMarkers(db, {
      user: USER,
      apply: true,
      limit: Number.POSITIVE_INFINITY,
    });

    expect(second.written).toBe(0);
    expect(second.alreadyPresent).toBe(2); // a1, r1
  });

  it('preserves an existing marker source/createdAt (no clobber)', async () => {
    await seedArticle('a1');
    await markersCollection(db, USER).doc('a1').set({
      key: 'a1',
      source: 'sync',
      createdAt: new Date('2020-01-01T00:00:00Z'),
    });

    const result = await backfillMarkers(db, {
      user: USER,
      apply: true,
      limit: Number.POSITIVE_INFINITY,
    });

    expect(result.alreadyPresent).toBe(1);
    expect(result.written).toBe(0);

    const marker = await markersCollection(db, USER).doc('a1').get();
    expect(marker.get('source')).toBe('sync'); // not overwritten to "backfill"
  });

  it('dry-run reports wouldWrite without writing anything', async () => {
    await seedArticle('a1', { resolvedId: 'r1' });

    const result = await backfillMarkers(db, {
      user: USER,
      apply: false,
      limit: Number.POSITIVE_INFINITY,
    });

    expect(result.wouldWrite).toBe(2);
    expect(result.written).toBe(0);
    expect(await markerIds()).toEqual([]);
  });
});
