import type { Firestore } from 'firebase-admin/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { userArticlesCollection } from '../articles.js';
import { computeUserCoverage } from '../coverage-gate.js';
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

describe('coverage gate (emulator)', () => {
  it('reports a gap (covered=false) before any markers exist', async () => {
    await seedArticle('a1');
    await seedArticle('a2', { resolvedId: 'r2' });

    const result = await computeUserCoverage(db, USER);

    expect(result.covered).toBe(false);
    expect(result.expectedCount).toBe(3); // a1, a2, r2
    expect([...result.missing].sort()).toEqual(['a1', 'a2', 'r2']);
  });

  it('reports full coverage (covered=true) after backfill --apply', async () => {
    await seedArticle('a1');
    await seedArticle('a2', { resolvedId: 'r2' });
    await backfillMarkers(db, { user: USER, apply: true, limit: Number.POSITIVE_INFINITY });

    const result = await computeUserCoverage(db, USER);

    expect(result.covered).toBe(true);
    expect(result.missing).toEqual([]);
  });
});
