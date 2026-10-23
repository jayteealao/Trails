import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import process from 'node:process';

import { Timestamp } from 'firebase-admin/firestore';
import type { Firestore, QuerySnapshot } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { handleUserArticleCreated } from '../src/handler.js';
import { clearEmulator, createTestDb, destroyTestDb } from './emulator.js';
import type { TestDb } from './emulator.js';

/**
 * The shared-link scenario: a share of a link, then a share of the
 * same link with ?utm_source=x. Each user article gets a server-written
 * canonicalId and marker, both name one shared article, and no second shared
 * article exists. Set SCENARIO_DUMP to a file path to write the resulting data
 * as JSON.
 */

const USER = 'scenario-user';
const FIRST = { itemId: 'scenarioItem0001', url: 'https://example.com/story' };
const SECOND = { itemId: 'scenarioItem0002', url: 'https://example.com/story?utm_source=x' };

let testDb: TestDb;
let db: Firestore;

beforeAll(async () => {
  testDb = createTestDb();
  db = testDb.db;
  await clearEmulator();
});

afterAll(async () => {
  await clearEmulator();
  await destroyTestDb(testDb);
});

function plain(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  }
  return value;
}

const dumpOf = (snap: QuerySnapshot) => Object.fromEntries(snap.docs.map((d) => [d.id, plain(d.data())]));

describe('shared-link scenario: two shares of one link', () => {
  it('links a share and its utm_source variant to one shared article with server-written links', async () => {
    let begins = 0;
    const beginArchive = async () => ({ requestId: `req-${++begins}` });
    const userArticles = db.collection('users').doc(USER).collection('articles');

    for (const share of [FIRST, SECOND]) {
      const data = { url: share.url, title: 'A story', timeAdded: 1_700_000_000 };
      await userArticles.doc(share.itemId).set(data);
      await handleUserArticleCreated({ db, userId: USER, itemId: share.itemId, data }, { beginArchive });
    }

    const [articlesSnap, markersSnap, sharedSnap] = await Promise.all([
      userArticles.get(),
      db.collection('users').doc(USER).collection('articleMarkers').get(),
      db.collection('articles').get(),
    ]);

    const dumpPath = process.env['SCENARIO_DUMP'];
    if (dumpPath) {
      await mkdir(dirname(dumpPath), { recursive: true });
      const dump = {
        [`users/${USER}/articles`]: dumpOf(articlesSnap),
        [`users/${USER}/articleMarkers`]: dumpOf(markersSnap),
        articles: dumpOf(sharedSnap),
      };
      await writeFile(dumpPath, `${JSON.stringify(dump, null, 2)}\n`);
    }

    const first = articlesSnap.docs.find((d) => d.id === FIRST.itemId)!;
    const second = articlesSnap.docs.find((d) => d.id === SECOND.itemId)!;
    const canonicalId = first.get('canonicalId');
    expect(typeof canonicalId).toBe('string');
    expect(second.get('canonicalId')).toBe(canonicalId);

    expect(sharedSnap.size).toBe(1);
    expect(sharedSnap.docs[0]!.id).toBe(canonicalId);
    expect(sharedSnap.docs[0]!.get('normalizedUrl')).toBe('https://example.com/story');

    // Both user articles name one shared id, so one marker (keyed by it) covers both.
    expect(markersSnap.size).toBe(1);
    const marker = markersSnap.docs[0]!;
    expect(marker.id).toBe(canonicalId);
    expect(marker.get('key')).toBe(canonicalId);
    expect(marker.get('source')).toBe('trigger');
    expect(begins).toBe(1);
  });
});
