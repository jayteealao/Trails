import { Timestamp } from 'firebase-admin/firestore';
import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { GatewayBeginError } from '../src/gateway-client.js';
import type { BeginArchive } from '../src/handler.js';
import { handleArchiveRetry } from '../src/retry.js';
import { clearEmulator, createTestDb, destroyTestDb } from './emulator.js';
import type { TestDb } from './emulator.js';

// Synthetic users and ids only.
const USER_A = 'userA';
const USER_B = 'userB';
const ITEM = 'itemRETRY001';
const SHARED = 'sharedRETRY1';
const ARCHIVES = { readability: { status: 'success', gcs_path: 'gs://test-bucket/readability.html' } };
const ROUNDS = 5;

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

const sharedRef = () => db.collection('articles').doc(SHARED);

async function seed(fields: Record<string, unknown> = {}): Promise<void> {
  await sharedRef().set({
    item_id: SHARED,
    url: 'https://example.com/retry',
    status: 'failed',
    error: 'boom',
    archives: ARCHIVES,
    ...fields,
  });
  for (const uid of [USER_A, USER_B]) {
    await db.collection('users').doc(uid).collection('articles').doc(ITEM).set({ canonicalId: SHARED });
  }
}

function retry(uid: string, beginArchive: BeginArchive) {
  return handleArchiveRetry({ db, userId: uid, itemId: ITEM }, { beginArchive });
}

/** A beginArchive stub that counts its calls. */
function countingBegin(): { begin: BeginArchive; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    begin: async (payload) => {
      calls.push(payload.request_id);
      return { requestId: payload.request_id };
    },
  };
}

describe('retry of a failed archive', () => {
  for (const [name, second] of [
    ['one user', USER_A],
    ['two users of one shared article', USER_B],
  ] as const) {
    it(`starts one run for two retries at the same time by ${name} (${ROUNDS} rounds)`, async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await seed();
        const { begin, calls } = countingBegin();
        const answers = await Promise.all([retry(USER_A, begin), retry(second, begin)]);
        expect(answers.map((a) => a.outcome).sort(), `round ${round}`).toEqual(['in_flight', 'started']);
        expect(calls).toEqual([SHARED]);
      }
    });
  }

  it('keeps archives and the earlier error through the claim and the start', async () => {
    await seed();
    const { begin } = countingBegin();
    expect(await retry(USER_A, begin)).toEqual({ outcome: 'started' });
    const doc = (await sharedRef().get()).data()!;
    expect(doc['archives']).toEqual(ARCHIVES);
    expect(doc['error']).toBe('boom');
    expect(doc['status']).toBe('processing');
    expect(doc['warg_request_id']).toBe(SHARED);
  });

  it('a refusal restores the earlier start time and keeps archives', async () => {
    const prior = Timestamp.fromMillis(1_000);
    await seed({ processing_started_at: prior });
    const answer = await retry(USER_A, async () => {
      throw new GatewayBeginError(400, '{"code":"INVALID_OPTIONS"}');
    });
    expect(answer).toEqual({ outcome: 'not_sent', reason: 'gateway' });
    const doc = (await sharedRef().get()).data()!;
    expect(doc['archives']).toEqual(ARCHIVES);
    expect(doc['status']).toBe('failed');
    expect(prior.isEqual(doc['processing_started_at'])).toBe(true);
  });

  it('a refusal of an article without a start time leaves none', async () => {
    await seed();
    await retry(USER_A, async () => {
      throw new GatewayBeginError(400, '{"code":"INVALID_OPTIONS"}');
    });
    expect((await sharedRef().get()).data()).not.toHaveProperty('processing_started_at');
  });

  it('a refusal after a newer start changes nothing', async () => {
    await seed();
    let newer: DocumentData | undefined;
    await retry(USER_A, async () => {
      await sharedRef().update({ processing_started_at: Timestamp.fromMillis(Date.now() + 60_000) });
      newer = (await sharedRef().get()).data();
      throw new GatewayBeginError(400, '{"code":"INVALID_OPTIONS"}');
    });
    expect(newer).toBeDefined();
    expect((await sharedRef().get()).data()).toEqual(newer);
  });
});
