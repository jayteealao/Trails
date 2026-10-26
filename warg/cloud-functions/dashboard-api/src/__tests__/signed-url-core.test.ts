import test from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import {
  resolveAndSignArchive,
  validateSignedUrlQuery,
  type ArchiveSigner,
} from '../signed-url-core.js';

// ── Fake Firestore ────────────────────────────────────────────────────────
// Minimal stand-in that models only the reads the core performs:
//   users/{uid}/articles/{itemId}        (ownership + link resolution)
//   users/{uid}/articleMarkers/{id}      (the server-written link marker)
//   articles/{sharedId}                  (the archive map)
// Keyed by itemId / marker id / shared id; a missing key models a non-existent
// doc (i.e. the requesting user does not own the article). Every read path is
// recorded in `reads`.

function makeSnap(data: Record<string, unknown> | undefined) {
  return { exists: data !== undefined, data: () => data };
}

function makeDb(
  config: {
    userArticles: Record<string, Record<string, unknown> | undefined>;
    canonical: Record<string, Record<string, unknown> | undefined>;
    markers?: Record<string, Record<string, unknown> | undefined>;
  },
  reads: string[] = []
): Firestore {
  const markers = config.markers ?? {};
  const db = {
    collection(name: string) {
      if (name === 'users') {
        return {
          doc() {
            return {
              collection(sub: string) {
                const store = sub === 'articleMarkers' ? markers : config.userArticles;
                return {
                  doc(id: string) {
                    return {
                      get: async () => {
                        reads.push(`users/${sub}/${id}`);
                        return makeSnap(store[id]);
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (name === 'articles') {
        return {
          doc(canonicalId: string) {
            return {
              get: async () => {
                reads.push(`articles/${canonicalId}`);
                return makeSnap(config.canonical[canonicalId]);
              },
            };
          },
        };
      }
      throw new Error(`unexpected collection: ${name}`);
    },
  };
  // Boundary cast: the fake implements only the slice of Firestore the core uses.
  return db as unknown as Firestore;
}

/** A marker body in the shape the server writes. */
function marker(key: string, itemId: string, source = 'trigger') {
  return { key, itemId, createdAt: 0, source };
}

const fakeSign: ArchiveSigner = async (objectPath) =>
  `https://signed.example/${encodeURIComponent(objectPath)}`;

// ── validateSignedUrlQuery ──────────────────────────────────────────────────

test('validateSignedUrlQuery rejects missing params', () => {
  const r = validateSignedUrlQuery(undefined, 'readability');
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.status, 400);
});

test('validateSignedUrlQuery rejects non-string params', () => {
  const r = validateSignedUrlQuery(['item1234'], 'readability');
  assert.equal(r.ok, false);
});

test('validateSignedUrlQuery rejects a malformed itemId', () => {
  const r = validateSignedUrlQuery('short', 'readability');
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error, 'Invalid itemId format');
});

test('validateSignedUrlQuery rejects an unknown archiveKey', () => {
  const r = validateSignedUrlQuery('item1234', 'not-a-real-key');
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error, 'Invalid archiveKey');
});

test('validateSignedUrlQuery accepts a well-formed query', () => {
  const r = validateSignedUrlQuery('item-1234', 'readability');
  assert.equal(r.ok, true);
  assert.equal(r.ok === true && r.itemId, 'item-1234');
  assert.equal(r.ok === true && r.archiveKey, 'readability');
});

// ── resolveAndSignArchive ───────────────────────────────────────────────────

test('signs the object for an owned article and resolves the canonical id', async () => {
  const db = makeDb({
    userArticles: { 'item1234': { canonicalId: 'canon-9' } },
    markers: { 'canon-9': marker('canon-9', 'item1234') },
    canonical: {
      'canon-9': {
        archives: {
          readability: { status: 'success', gcs_path: 'gs://htbase-archives-standard/a/read.json' },
        },
      },
    },
  });

  const result = await resolveAndSignArchive({
    db,
    ownerUid: 'u1',
    itemId: 'item1234',
    archiveKey: 'readability',
    sign: fakeSign,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.body.item_id, 'item1234');
  assert.equal(result.body.canonical_item_id, 'canon-9');
  assert.equal(result.body.archive_key, 'readability');
  assert.equal(result.body.archive_source_key, 'readability');
  assert.equal(result.objectPath, 'a/read.json');
  assert.equal(result.body.url, 'https://signed.example/a%2Fread.json');
});

test('resolves an archive-key alias (readability → readability_json)', async () => {
  const db = makeDb({
    userArticles: { 'item1234': {} },
    markers: { 'item1234': marker('item1234', 'item1234') },
    canonical: {
      'item1234': {
        archives: {
          readability_json: {
            status: 'success',
            gcs_path: 'gs://htbase-archives-standard/a/readability.json',
          },
        },
      },
    },
  });

  const result = await resolveAndSignArchive({
    db,
    ownerUid: 'u1',
    itemId: 'item1234',
    archiveKey: 'readability',
    sign: fakeSign,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.body.archive_source_key, 'readability_json');
  assert.equal(result.objectPath, 'a/readability.json');
});

test('returns 404 when the requesting user does not own the article', async () => {
  const db = makeDb({ userArticles: {}, canonical: {} });

  const result = await resolveAndSignArchive({
    db,
    ownerUid: 'u1',
    itemId: 'item1234',
    archiveKey: 'readability',
    sign: fakeSign,
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 404);
  assert.equal(result.ok === false && result.error, 'Article not found');
});

test('returns 404 when the canonical article is absent', async () => {
  const db = makeDb({
    userArticles: { 'item1234': { resolvedId: 'canon-9' } },
    markers: { 'item1234': marker('item1234', 'item1234') },
    canonical: {},
  });

  const result = await resolveAndSignArchive({
    db,
    ownerUid: 'u1',
    itemId: 'item1234',
    archiveKey: 'readability',
    sign: fakeSign,
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error, 'Canonical article not found');
});

test('returns 404 when the requested archive is missing or not successful', async () => {
  const db = makeDb({
    userArticles: { 'item1234': {} },
    markers: { 'item1234': marker('item1234', 'item1234') },
    canonical: {
      'item1234': { archives: { readability: { status: 'failed' } } },
    },
  });

  const result = await resolveAndSignArchive({
    db,
    ownerUid: 'u1',
    itemId: 'item1234',
    archiveKey: 'readability',
    sign: fakeSign,
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 404);
});

// M2: gcs_path bucket mismatch should surface as an error (thrown from toObjectPath,
// propagates as an unhandled rejection — callers will see a thrown error, not a
// structured result, which is intentional: bucket mismatch is a data-integrity bug).
test('throws when gcs_path references a different bucket', async () => {
  const db = makeDb({
    userArticles: { 'item1234': {} },
    markers: { 'item1234': marker('item1234', 'item1234') },
    canonical: {
      'item1234': {
        archives: {
          readability: {
            status: 'success',
            gcs_path: 'gs://wrong-bucket/a/read.json',
          },
        },
      },
    },
  });

  await assert.rejects(
    () =>
      resolveAndSignArchive({
        db,
        ownerUid: 'u1',
        itemId: 'item1234',
        archiveKey: 'readability',
        sign: fakeSign,
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes('bucket mismatch'));
      return true;
    }
  );
});

// M4: sign() failure should return a structured 502, not propagate.
test('returns 502 when sign() throws', async () => {
  const db = makeDb({
    userArticles: { 'item1234': {} },
    markers: { 'item1234': marker('item1234', 'item1234') },
    canonical: {
      'item1234': {
        archives: {
          readability: {
            status: 'success',
            gcs_path: 'gs://htbase-archives-standard/a/read.json',
          },
        },
      },
    },
  });

  const failSign: ArchiveSigner = async () => {
    throw new Error('IAM signBlob unavailable');
  };

  const result = await resolveAndSignArchive({
    db,
    ownerUid: 'u1',
    itemId: 'item1234',
    archiveKey: 'readability',
    sign: failSign,
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 502);
  assert.equal(result.ok === false && result.error, 'Failed to generate signed URL');
});

// ── Link marker and canonicalId ─────────────────────────────────────────────

const readArchive = (path: string) => ({
  archives: { readability: { status: 'success', gcs_path: `gs://htbase-archives-standard/${path}` } },
});

function countingSigner() {
  const calls: string[] = [];
  const sign: ArchiveSigner = async (objectPath) => {
    calls.push(objectPath);
    return `https://signed.example/${encodeURIComponent(objectPath)}`;
  };
  return { sign, calls };
}

const sign1234 = (db: Firestore, sign: ArchiveSigner = fakeSign) =>
  resolveAndSignArchive({ db, ownerUid: 'u1', itemId: 'item1234', archiveKey: 'readability', sign });

// A user article whose app-written resolvedId names another user's shared article.
const forgedLink = { canonicalId: 'own-share1', resolvedId: 'victim-sh1' };

test('signs the canonicalId shared article and ignores a foreign resolvedId', async () => {
  const reads: string[] = [];
  const db = makeDb(
    {
      userArticles: { item1234: forgedLink },
      markers: { 'own-share1': marker('own-share1', 'item1234') },
      canonical: {
        'own-share1': readArchive('own/read.json'),
        'victim-sh1': readArchive('victim/read.json'),
      },
    },
    reads
  );
  const { sign, calls } = countingSigner();

  const result = await sign1234(db, sign);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.objectPath, 'own/read.json');
  assert.equal(result.body.canonical_item_id, 'own-share1');
  assert.deepEqual(calls, ['own/read.json']);
  assert.ok(!reads.includes('articles/victim-sh1'));
});

test('refuses without a marker for the linked shared article and signs nothing', async () => {
  const reads: string[] = [];
  const db = makeDb(
    {
      userArticles: { item1234: forgedLink },
      // A marker for the other user's shared article proves nothing about this link.
      markers: { 'victim-sh1': marker('victim-sh1', 'item1234') },
      canonical: {
        'own-share1': readArchive('own/read.json'),
        'victim-sh1': readArchive('victim/read.json'),
      },
    },
    reads
  );
  const { sign, calls } = countingSigner();

  const result = await sign1234(db, sign);

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 404);
  assert.equal(result.ok === false && result.error, 'Article not found');
  assert.equal(calls.length, 0);
  assert.ok(!reads.includes('articles/victim-sh1'));
});

test('refuses with the same answer when the unlinked shared article does not exist', async () => {
  const db = makeDb({ userArticles: { item1234: { canonicalId: 'own-share1' } }, canonical: {} });
  const { sign, calls } = countingSigner();

  const result = await sign1234(db, sign);

  assert.equal(result.ok === false && result.error, 'Article not found');
  assert.equal(calls.length, 0);
});

test('follows a merged duplicate once and signs the winner with the loser marker', async () => {
  const db = makeDb({
    userArticles: { item1234: { canonicalId: 'loser-0001' } },
    markers: { 'loser-0001': marker('loser-0001', 'item1234') },
    canonical: {
      'loser-0001': { mergedInto: 'winner-001', ...readArchive('loser/read.json') },
      'winner-001': readArchive('winner/read.json'),
    },
  });
  const { sign, calls } = countingSigner();

  const result = await sign1234(db, sign);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.body.canonical_item_id, 'winner-001');
  assert.deepEqual(calls, ['winner/read.json']);
});

test('accepts a marker for the merge winner when the link still names the duplicate', async () => {
  const db = makeDb({
    userArticles: { item1234: { canonicalId: 'loser-0001' } },
    markers: { 'winner-001': marker('winner-001', 'item1234', 'merge') },
    canonical: {
      'loser-0001': { mergedInto: 'winner-001', ...readArchive('loser/read.json') },
      'winner-001': readArchive('winner/read.json'),
    },
  });

  const result = await sign1234(db);

  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.body.canonical_item_id, 'winner-001');
});

test('after a merge, signs the winner named by canonicalId with no extra hop', async () => {
  const reads: string[] = [];
  const db = makeDb(
    {
      userArticles: { item1234: { canonicalId: 'winner-001' } },
      markers: {
        'loser-0001': marker('loser-0001', 'item1234'),
        'winner-001': marker('winner-001', 'item1234', 'merge'),
      },
      canonical: {
        'loser-0001': { mergedInto: 'winner-001', ...readArchive('loser/read.json') },
        'winner-001': readArchive('winner/read.json'),
      },
    },
    reads
  );

  const result = await sign1234(db);

  assert.equal(result.ok === true && result.objectPath, 'winner/read.json');
  assert.ok(!reads.includes('articles/loser-0001'));
});

test('after a merge, a merge-written winner marker alone is enough (source is not read)', async () => {
  const db = makeDb({
    userArticles: { item1234: { canonicalId: 'winner-001' } },
    markers: { 'winner-001': marker('winner-001', 'item1234', 'merge') },
    canonical: { 'winner-001': readArchive('winner/read.json') },
  });

  const result = await sign1234(db);

  assert.equal(result.ok === true && result.objectPath, 'winner/read.json');
});

test('mid-merge, before the duplicate is marked, signs its own archive', async () => {
  const db = makeDb({
    userArticles: { item1234: { canonicalId: 'loser-0001' } },
    markers: { 'loser-0001': marker('loser-0001', 'item1234') },
    canonical: {
      'loser-0001': readArchive('loser/read.json'),
      'winner-001': readArchive('winner/read.json'),
    },
  });

  const result = await sign1234(db);

  assert.equal(result.ok === true && result.objectPath, 'loser/read.json');
  assert.equal(result.ok === true && result.body.canonical_item_id, 'loser-0001');
});

test('skipMarkerCheck signs without a marker (single-user dashboard lane)', async () => {
  const db = makeDb({
    userArticles: { item1234: { canonicalId: 'own-share1' } },
    canonical: { 'own-share1': readArchive('own/read.json') },
  });
  const { sign, calls } = countingSigner();

  const result = await resolveAndSignArchive({
    db,
    ownerUid: 'u1',
    itemId: 'item1234',
    archiveKey: 'readability',
    sign,
    skipMarkerCheck: true,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['own/read.json']);
});
