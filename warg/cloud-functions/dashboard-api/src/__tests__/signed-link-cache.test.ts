import test from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import { resolveAndSignArchive, type ArchiveSigner } from '../signed-url-core.js';
import { SignedLinkCache, sharedSignedLinkCache } from '../signed-link-cache.js';

// A counting signer, a fake clock and a fresh cache per test. The Firestore
// stand-in models ownership, the server-written link marker and the archive map.

const T0 = Date.UTC(2026, 0, 1);
const MIN = 60 * 1000;

function makeDb(opts: { owner?: boolean; marker?: boolean; paths?: Record<string, string> } = {}): Firestore {
  const { owner = true, marker = true } = opts;
  const paths = opts.paths ?? { 'canon-01': 'gs://htbase-archives-standard/a/read.json' };
  const snap = (data: Record<string, unknown> | undefined) => ({ exists: data !== undefined, data: () => data });
  const db = {
    collection(name: string) {
      if (name === 'users') {
        return {
          doc: () => ({
            collection: (sub: string) => ({
              doc: (id: string) => ({
                get: async () => {
                  if (sub === 'articleMarkers') return snap(marker ? { key: id, source: 'trigger' } : undefined);
                  return snap(owner ? { canonicalId: id.replace('item', 'canon') } : undefined);
                },
              }),
            }),
          }),
        };
      }
      return {
        doc: (id: string) => ({
          get: async () =>
            snap(
              paths[id]
                ? { archives: { readability: { status: 'success', gcs_path: paths[id] } } }
                : undefined
            ),
        }),
      };
    },
  };
  // Boundary cast: the fake implements only the reads the signing core makes.
  return db as unknown as Firestore;
}

function countingSigner() {
  const calls: Array<{ objectPath: string; expiresAt: Date }> = [];
  const sign: ArchiveSigner = async (objectPath, expiresAt) => {
    calls.push({ objectPath, expiresAt });
    return `https://signed.example/${encodeURIComponent(objectPath)}?n=${calls.length}`;
  };
  return { sign, calls };
}

async function request(
  db: Firestore,
  sign: ArchiveSigner,
  cache: SignedLinkCache | null | undefined,
  nowMs: number,
  itemId = 'item-01'
) {
  return resolveAndSignArchive({
    db,
    ownerUid: 'dash-user',
    itemId,
    archiveKey: 'readability',
    sign,
    ...(cache !== undefined ? { cache } : {}),
    now: () => nowMs,
  });
}

test('AC 4: a link with more than 5 minutes left is reused; with 5 minutes or less a new one is signed', async () => {
  const db = makeDb();
  const cache = new SignedLinkCache();
  const { sign, calls } = countingSigner();

  const first = await request(db, sign, cache, T0);
  assert.equal(calls.length, 1);
  assert.ok(first.ok);
  if (!first.ok) return;
  assert.equal(first.body.expires_at, new Date(T0 + 15 * MIN).toISOString());

  const reused = await request(db, sign, cache, T0 + 9 * MIN);
  assert.equal(calls.length, 1, 'no signing call with 6 minutes left');
  assert.ok(reused.ok);
  if (!reused.ok) return;
  assert.equal(reused.body.url, first.body.url);
  assert.equal(reused.body.expires_at, first.body.expires_at);

  const fresh = await request(db, sign, cache, T0 + 10 * MIN);
  assert.equal(calls.length, 2, 'a new link with exactly 5 minutes left');
  assert.ok(fresh.ok);
  if (!fresh.ok) return;
  assert.notEqual(fresh.body.url, first.body.url);
  assert.equal(fresh.body.expires_at, new Date(T0 + 25 * MIN).toISOString());
});

test('another object path is signed separately', async () => {
  const db = makeDb({
    paths: {
      'canon-01': 'gs://htbase-archives-standard/a/read.json',
      'canon-02': 'gs://htbase-archives-standard/b/read.json',
    },
  });
  const cache = new SignedLinkCache();
  const { sign, calls } = countingSigner();
  await request(db, sign, cache, T0, 'item-01');
  await request(db, sign, cache, T0, 'item-02');
  assert.deepEqual(calls.map((c) => c.objectPath), ['a/read.json', 'b/read.json']);
  assert.equal(cache.size, 2);
});

test('a failed signing is not cached', async () => {
  const db = makeDb();
  const cache = new SignedLinkCache();
  let attempts = 0;
  const failing: ArchiveSigner = async () => {
    attempts += 1;
    throw new Error('signBlob denied');
  };
  const failed = await request(db, failing, cache, T0);
  assert.deepEqual(failed, { ok: false, status: 502, error: 'Failed to generate signed URL' });
  assert.equal(cache.size, 0);

  const { sign, calls } = countingSigner();
  const next = await request(db, sign, cache, T0 + MIN);
  assert.equal(attempts, 1);
  assert.equal(calls.length, 1);
  assert.ok(next.ok);
});

test('a caller without a marker for a cached object gets 404 and no signing call', async () => {
  const cache = new SignedLinkCache();
  const { sign, calls } = countingSigner();
  await request(makeDb(), sign, cache, T0);
  assert.equal(calls.length, 1);

  const refused = await request(makeDb({ marker: false }), sign, cache, T0 + MIN);
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.status, 404);
  const notOwner = await request(makeDb({ owner: false }), sign, cache, T0 + MIN);
  assert.equal(!notOwner.ok && notOwner.status, 404);
  assert.equal(calls.length, 1);
});

test('the shared cache is not used with an injected signer unless a cache is passed', async () => {
  const before = sharedSignedLinkCache.size;
  const { sign, calls } = countingSigner();
  await request(makeDb(), sign, undefined, T0);
  await request(makeDb(), sign, undefined, T0);
  assert.equal(calls.length, 2);
  assert.equal(sharedSignedLinkCache.size, before);
});

test('the cache evicts the oldest entry beyond its size and prunes expired ones', () => {
  const cache = new SignedLinkCache(2);
  cache.set('p1', 'u1', T0 + 15 * MIN, T0);
  cache.set('p2', 'u2', T0 + 15 * MIN, T0);
  cache.set('p3', 'u3', T0 + 15 * MIN, T0);
  assert.equal(cache.size, 2);
  assert.equal(cache.get('p1', T0), undefined);
  assert.equal(cache.get('p3', T0)?.url, 'u3');

  cache.set('p4', 'u4', T0 + 40 * MIN, T0 + 20 * MIN);
  assert.equal(cache.size, 1, 'expired entries are pruned on write');
});
