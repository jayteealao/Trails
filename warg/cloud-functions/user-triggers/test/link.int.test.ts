import { normalizeUrl } from '@warg/url-normalizer';
import { Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { handleUserArticleCreated, RETRY_WINDOW_MS } from '../src/handler.js';
import type { BeginArchive } from '../src/handler.js';
import { clearEmulator, createTestDb, destroyTestDb } from './emulator.js';
import type { TestDb } from './emulator.js';

// Synthetic users and ids only.
const USER_A = 'userA';
const USER_B = 'userB';

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

/** A beginArchive stub that counts its calls. */
function beginStub(): BeginArchive & { calls: Array<{ request_id: string }> } {
  const calls: Array<{ request_id: string }> = [];
  const fn = (async (payload) => {
    calls.push({ request_id: payload.request_id });
    return { requestId: `req-${calls.length}` };
  }) as BeginArchive & { calls: Array<{ request_id: string }> };
  fn.calls = calls;
  return fn;
}

const userArticle = (uid: string, itemId: string) =>
  db.collection('users').doc(uid).collection('articles').doc(itemId);
const marker = (uid: string, key: string) => db.collection('users').doc(uid).collection('articleMarkers').doc(key);

/** Writes the user article the trigger fires for and returns its data, as the event carries it. */
async function seedUserArticle(uid: string, itemId: string, url?: string): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = { title: 'A story', timeAdded: 1_700_000_000 };
  if (url !== undefined) data['url'] = url;
  await userArticle(uid, itemId).set(data);
  return data;
}

async function fire(uid: string, itemId: string, data: Record<string, unknown>, begin: BeginArchive) {
  return handleUserArticleCreated({ db, userId: uid, itemId, data }, { beginArchive: begin });
}

async function sharedByNormalizedUrl(normalizedUrl: string) {
  return (await db.collection('articles').where('normalizedUrl', '==', normalizedUrl).get()).docs;
}

describe('server-owned link trigger', () => {
  it('links a second user to an existing shared article without touching its archives', async () => {
    const url = 'https://example.com/ac6-story?utm_source=newsletter';
    const n = normalizeUrl(url);
    const archives = {
      readability: { status: 'success', gcs_path: 'gs://test-bucket/sharedAAAA0001/readability.html' },
    };
    await db.collection('articles').doc('sharedAAAA0001').set({
      item_id: 'sharedAAAA0001',
      url: 'https://example.com/ac6-story',
      normalizedUrl: n,
      status: 'complete',
      archives,
      stats: { total_saves: 1 },
      created_at: Timestamp.fromMillis(1_000),
    });
    const begin = beginStub();
    const data = await seedUserArticle(USER_B, 'itemBBBB0001', url);

    expect(await fire(USER_B, 'itemBBBB0001', data, begin)).toBe('linked');

    const shared = (await db.collection('articles').doc('sharedAAAA0001').get()).data()!;
    expect(shared['archives']).toEqual(archives);
    expect(shared['stats']['total_saves']).toBe(2);
    const user = (await userArticle(USER_B, 'itemBBBB0001').get()).data()!;
    expect(user['canonicalId']).toBe('sharedAAAA0001');
    expect(user['resolvedId']).toBe('sharedAAAA0001');
    const m = (await marker(USER_B, 'sharedAAAA0001').get()).data()!;
    expect(m['key']).toBe('sharedAAAA0001');
    expect(m['itemId']).toBe('itemBBBB0001');
    expect(m['source']).toBe('trigger');
    expect(m['createdAt']).toBeInstanceOf(Timestamp);
    expect(begin.calls).toHaveLength(0);
    expect(await db.collection('articles').get()).toHaveProperty('size', 1);
  });

  it('gives one shared article, one marker and one archive start for a retried event, run one after the other', async () => {
    const url = 'https://example.com/ac7-sequential';
    const begin = beginStub();
    const data = await seedUserArticle(USER_A, 'itemAAAA0007', url);

    expect(await fire(USER_A, 'itemAAAA0007', data, begin)).toBe('created');
    expect(await fire(USER_A, 'itemAAAA0007', data, begin)).toBe('already-linked');

    const shared = await sharedByNormalizedUrl(normalizeUrl(url));
    expect(shared).toHaveLength(1);
    expect(shared[0]!.id).toBe('itemAAAA0007');
    expect(shared[0]!.get('stats.total_saves')).toBe(1);
    expect(shared[0]!.get('status')).toBe('processing');
    expect(shared[0]!.get('warg_request_id')).toBe('req-1');
    expect((await db.collection('users').doc(USER_A).collection('articleMarkers').get()).size).toBe(1);
    expect(begin.calls).toEqual([{ request_id: 'itemAAAA0007' }]);
    expect((await userArticle(USER_A, 'itemAAAA0007').get()).get('archival_triggered')).toBe(true);
  });

  it('gives one shared article, one marker and one archive start for a retried event, run at the same time', async () => {
    const url = 'https://example.com/ac7-concurrent';
    const begin = beginStub();
    const data = await seedUserArticle(USER_A, 'itemAAAA0077', url);

    const results = await Promise.all([
      fire(USER_A, 'itemAAAA0077', data, begin),
      fire(USER_A, 'itemAAAA0077', data, begin),
    ]);

    expect([...results].sort()).toEqual(['already-linked', 'created']);
    const shared = await sharedByNormalizedUrl(normalizeUrl(url));
    expect(shared).toHaveLength(1);
    expect(shared[0]!.get('stats.total_saves')).toBe(1);
    expect((await db.collection('users').doc(USER_A).collection('articleMarkers').get()).size).toBe(1);
    expect(begin.calls).toHaveLength(1);
  });

  it('links concurrent first shares of one new URL by two users to one shared article (5 rounds)', async () => {
    for (let round = 0; round < 5; round++) {
      const url = `https://example.com/concurrent-${round}?fbclid=x${round}`;
      const n = normalizeUrl(url);
      const idA = `itemA${round}concurrent`;
      const idB = `itemB${round}concurrent`;
      const begin = beginStub();
      const [dataA, dataB] = await Promise.all([seedUserArticle(USER_A, idA, url), seedUserArticle(USER_B, idB, url)]);

      await Promise.all([fire(USER_A, idA, dataA, begin), fire(USER_B, idB, dataB, begin)]);

      const shared = await sharedByNormalizedUrl(n);
      expect(shared, `round ${round}`).toHaveLength(1);
      const sharedId = shared[0]!.id;
      expect([idA, idB]).toContain(sharedId);
      expect(shared[0]!.get('stats.total_saves')).toBe(2);
      expect((await userArticle(USER_A, idA).get()).get('canonicalId')).toBe(sharedId);
      expect((await userArticle(USER_B, idB).get()).get('canonicalId')).toBe(sharedId);
      expect((await marker(USER_A, sharedId).get()).exists).toBe(true);
      expect((await marker(USER_B, sharedId).get()).exists).toBe(true);
      expect(begin.calls).toEqual([{ request_id: sharedId }]);
      await clearEmulator();
    }
  });

  it.each([['short01'], ['bad.id.with.dots']])(
    'creates nothing and records an error for the invalid id %s',
    async (itemId) => {
      const begin = beginStub();
      const data = await seedUserArticle(USER_A, itemId, 'https://example.com/ac8');

      expect(await fire(USER_A, itemId, data, begin)).toBe('invalid-id');

      expect((await db.collection('articles').get()).size).toBe(0);
      const user = (await userArticle(USER_A, itemId).get()).data()!;
      expect(user['error']).toBe('Invalid article id');
      expect(user['error_at']).toBeInstanceOf(Timestamp);
      expect(user['canonicalId']).toBeUndefined();
      expect((await db.collection('users').doc(USER_A).collection('articleMarkers').get()).size).toBe(0);
      expect(begin.calls).toHaveLength(0);
    }
  );

  it('links to the merge winner and never to a merged stub', async () => {
    const url = 'https://example.com/merged-story';
    const n = normalizeUrl(url);
    await db.collection('articles').doc('loserAAAA001').set({
      url,
      normalizedUrl: n,
      mergedInto: 'winnerAAA001',
      created_at: Timestamp.fromMillis(500),
      stats: { total_saves: 1 },
    });
    await db.collection('articles').doc('winnerAAA001').set({
      url,
      normalizedUrl: n,
      status: 'complete',
      created_at: Timestamp.fromMillis(1_000),
      stats: { total_saves: 3 },
    });
    const begin = beginStub();
    const data = await seedUserArticle(USER_A, 'itemMerged01', url);

    expect(await fire(USER_A, 'itemMerged01', data, begin)).toBe('linked');

    expect((await userArticle(USER_A, 'itemMerged01').get()).get('canonicalId')).toBe('winnerAAA001');
    expect((await marker(USER_A, 'winnerAAA001').get()).exists).toBe(true);
    expect((await marker(USER_A, 'loserAAAA001').get()).exists).toBe(false);
    expect((await db.collection('articles').doc('loserAAAA001').get()).get('stats.total_saves')).toBe(1);
    expect(begin.calls).toHaveLength(0);
  });

  it('links an existing articles/{itemId} with the same URL and no normalizedUrl, unchanged', async () => {
    const url = 'https://example.com/legacy-story';
    const archives = { pdf: { status: 'success', gcs_path: 'gs://test-bucket/itemLegacy01/page.pdf' } };
    await db.collection('articles').doc('itemLegacy01').set({
      item_id: 'itemLegacy01',
      url,
      status: 'complete',
      archives,
      stats: { total_saves: 1 },
    });
    const begin = beginStub();
    const data = await seedUserArticle(USER_A, 'itemLegacy01', url);

    expect(await fire(USER_A, 'itemLegacy01', data, begin)).toBe('linked');

    const all = await db.collection('articles').get();
    expect(all.size).toBe(1);
    const shared = all.docs[0]!.data();
    expect(shared['archives']).toEqual(archives);
    expect(shared['url']).toBe(url);
    expect(shared['stats']['total_saves']).toBe(2);
    expect((await userArticle(USER_A, 'itemLegacy01').get()).get('canonicalId')).toBe('itemLegacy01');
    expect(begin.calls).toHaveLength(0);
  });

  it('refuses to link or overwrite an existing articles/{itemId} with a different URL', async () => {
    const existing = {
      item_id: 'itemClash001',
      url: 'https://other.example.org/another-story',
      status: 'complete',
      archives: { readability: { status: 'success' } },
      stats: { total_saves: 4 },
    };
    await db.collection('articles').doc('itemClash001').set(existing);
    const begin = beginStub();
    const data = await seedUserArticle(USER_A, 'itemClash001', 'https://example.com/clash-story');

    expect(await fire(USER_A, 'itemClash001', data, begin)).toBe('conflict');

    expect((await db.collection('articles').doc('itemClash001').get()).data()).toEqual(existing);
    expect((await db.collection('articles').get()).size).toBe(1);
    const user = (await userArticle(USER_A, 'itemClash001').get()).data()!;
    expect(user['error']).toBe('Shared article id conflict');
    expect(user['canonicalId']).toBeUndefined();
    expect((await db.collection('users').doc(USER_A).collection('articleMarkers').get()).size).toBe(0);
    expect(begin.calls).toHaveLength(0);
  });

  it('keeps the missing-URL error', async () => {
    const begin = beginStub();
    const data = await seedUserArticle(USER_A, 'itemNoUrl001');

    expect(await fire(USER_A, 'itemNoUrl001', data, begin)).toBe('missing-url');

    expect((await userArticle(USER_A, 'itemNoUrl001').get()).get('error')).toBe('Missing URL');
    expect((await db.collection('articles').get()).size).toBe(0);
    expect(begin.calls).toHaveLength(0);
  });

  it('throws inside the retry window when the archive start fails, and the retried event starts it', async () => {
    const data = await seedUserArticle(USER_A, 'itemRetry001', 'https://example.com/retry');
    const failing: BeginArchive = async () => {
      throw new Error('gateway unavailable');
    };
    const now = Date.now();

    await expect(
      handleUserArticleCreated(
        { db, userId: USER_A, itemId: 'itemRetry001', data, eventTimeMs: now },
        { beginArchive: failing, nowMs: () => now },
      ),
    ).rejects.toThrow('gateway unavailable');
    const pending = (await db.collection('articles').doc('itemRetry001').get()).data()!;
    expect(pending['status']).toBe('pending');
    expect((await userArticle(USER_A, 'itemRetry001').get()).get('canonicalId')).toBe('itemRetry001');

    const begin = beginStub();
    expect(
      await handleUserArticleCreated(
        { db, userId: USER_A, itemId: 'itemRetry001', data, eventTimeMs: now },
        { beginArchive: begin, nowMs: () => now + 1000 },
      ),
    ).toBe('already-linked');
    expect(begin.calls).toEqual([{ request_id: 'itemRetry001' }]);
    expect((await db.collection('articles').doc('itemRetry001').get()).get('status')).toBe('processing');
  });

  it('records the failure once the retry window has passed', async () => {
    const data = await seedUserArticle(USER_A, 'itemRetry002', 'https://example.com/retry-late');
    const failing: BeginArchive = async () => {
      throw new Error('gateway unavailable');
    };
    const eventTimeMs = Date.now();

    expect(
      await handleUserArticleCreated(
        { db, userId: USER_A, itemId: 'itemRetry002', data, eventTimeMs },
        { beginArchive: failing, nowMs: () => eventTimeMs + RETRY_WINDOW_MS },
      ),
    ).toBe('error');
    expect((await db.collection('articles').doc('itemRetry002').get()).get('status')).toBe('failed');
    expect((await userArticle(USER_A, 'itemRetry002').get()).get('error')).toBe('gateway unavailable');
  });
});
