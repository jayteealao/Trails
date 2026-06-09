import test from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import {
  resolveAndSignArchive,
  validateSignedUrlQuery,
  type ArchiveSigner,
} from '../signed-url-core.js';

// ── Fake Firestore ────────────────────────────────────────────────────────
// Minimal stand-in that models only the two reads the core performs:
//   users/{uid}/articles/{itemId}   (ownership + canonical resolution)
//   articles/{canonicalId}          (the archive map)
// Keyed by itemId / canonicalId; a missing key models a non-existent doc
// (i.e. the requesting user does not own the article).

function makeSnap(data: Record<string, unknown> | undefined) {
  return { exists: data !== undefined, data: () => data };
}

function makeDb(config: {
  userArticles: Record<string, Record<string, unknown> | undefined>;
  canonical: Record<string, Record<string, unknown> | undefined>;
}): Firestore {
  const db = {
    collection(name: string) {
      if (name === 'users') {
        return {
          doc() {
            return {
              collection() {
                return {
                  doc(itemId: string) {
                    return { get: async () => makeSnap(config.userArticles[itemId]) };
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
            return { get: async () => makeSnap(config.canonical[canonicalId]) };
          },
        };
      }
      throw new Error(`unexpected collection: ${name}`);
    },
  };
  // Boundary cast: the fake implements only the slice of Firestore the core uses.
  return db as unknown as Firestore;
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
    userArticles: { 'item1234': { resolvedId: 'canon-9' } },
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
