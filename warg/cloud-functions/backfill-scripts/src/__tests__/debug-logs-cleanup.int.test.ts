import type { Firestore } from 'firebase-admin/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { cleanupDebugLogs } from '../debug-logs-cleanup.js';
import { clearEmulator, createTestDb, destroyTestDb } from './emulator.js';
import type { TestDb } from './emulator.js';

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

async function seedLegacyFlat(id: string): Promise<void> {
  await db
    .collection('debug_logs')
    .doc(id)
    .set({ sessionId: id, device: 'Pixel 7', events: [] });
}

async function seedOwnerSession(uid: string, sessionDocId: string): Promise<void> {
  // A session doc under debug_logs/{uid}/sessions/* — the parent debug_logs/{uid}
  // is a "missing" doc that only owns the sessions subcollection.
  await db
    .collection('debug_logs')
    .doc(uid)
    .collection('sessions')
    .doc(sessionDocId)
    .set({ sessionId: sessionDocId, events: [] });
}

describe('debug_logs cleanup (emulator)', () => {
  it('deletes a legacy flat doc and preserves a uid-scoped sessions parent', async () => {
    await seedLegacyFlat('abc12345_session');
    await seedOwnerSession('uid-1', 'sess-1_a1');

    const dry = await cleanupDebugLogs(db, { apply: false, limit: Number.POSITIVE_INFINITY });
    expect(dry.legacyFlat).toBe(1);
    expect(dry.ownerParent).toBe(1);
    expect(dry.deleted).toBe(0);

    const applied = await cleanupDebugLogs(db, {
      apply: true,
      limit: Number.POSITIVE_INFINITY,
    });
    expect(applied.deleted).toBe(1);
    expect(applied.errors).toBe(0);

    const legacy = await db.collection('debug_logs').doc('abc12345_session').get();
    expect(legacy.exists).toBe(false);

    const session = await db
      .collection('debug_logs')
      .doc('uid-1')
      .collection('sessions')
      .doc('sess-1_a1')
      .get();
    expect(session.exists).toBe(true);
  });

  it('never deletes during a dry-run, even with legacy docs present', async () => {
    await seedLegacyFlat('abc12345_session');

    const dry = await cleanupDebugLogs(db, { apply: false, limit: Number.POSITIVE_INFINITY });
    expect(dry.deleted).toBe(0);

    const legacy = await db.collection('debug_logs').doc('abc12345_session').get();
    expect(legacy.exists).toBe(true);
  });
});
