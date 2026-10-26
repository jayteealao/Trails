import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  countPlaceholders,
  readCommittedFirestoreRules,
  readStorageRules,
  stampGraceEnd,
} from './rules-source';

const OWNER = 'owner-uid';
const OTHER = 'other-uid';
const ANON = 'anon-uid';

const DAY_MS = 24 * 60 * 60 * 1000;

// Three rule variants, one project id each. The emulator cannot move
// request.time, so the grace end is stamped into a copy of the rules instead.
// Hosts and ports come from the variables `firebase emulators:exec` sets.
//   committed  — the file as committed (grace end 0: no grace) + storage.rules
//   graceOpen  — grace end one day from now
//   graceEnded — grace end one day ago
let committed: RulesTestEnvironment;
let graceOpen: RulesTestEnvironment;
let graceEnded: RulesTestEnvironment;

beforeAll(async () => {
  const source = readCommittedFirestoreRules();
  committed = await initializeTestEnvironment({
    projectId: 'demo-trails',
    firestore: { rules: source },
    storage: { rules: readStorageRules() },
  });
  graceOpen = await initializeTestEnvironment({
    projectId: 'demo-trails-grace-open',
    firestore: { rules: stampGraceEnd(source, Date.now() + DAY_MS) },
  });
  graceEnded = await initializeTestEnvironment({
    projectId: 'demo-trails-grace-ended',
    firestore: { rules: stampGraceEnd(source, Date.now() - DAY_MS) },
  });
});

afterEach(async () => {
  await Promise.all([committed, graceOpen, graceEnded].map((env) => env.clearFirestore()));
});

afterAll(async () => {
  await Promise.all([committed, graceOpen, graceEnded].map((env) => env?.cleanup()));
});

const ownerDb = (env: RulesTestEnvironment = committed) => env.authenticatedContext(OWNER).firestore();
const otherDb = (env: RulesTestEnvironment = committed) => env.authenticatedContext(OTHER).firestore();
const anonDb = (env: RulesTestEnvironment = committed) => env.unauthenticatedContext().firestore();
// Signed-in but via Anonymous Auth (request.auth != null, sign_in_provider 'anonymous').
const anonAuthDb = (env: RulesTestEnvironment = committed) =>
  env.authenticatedContext(ANON, { firebase: { sign_in_provider: 'anonymous' } }).firestore();

// Server writes (the Admin SDK bypasses rules; the rules bypass stands in for it).
const seedUserArticle = (env: RulesTestEnvironment, uid: string, itemId: string, data: DocumentData) =>
  env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `users/${uid}/articles/${itemId}`), data);
  });
const seedSharedArticle = (env: RulesTestEnvironment, id: string, data: DocumentData) =>
  env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `articles/${id}`), data);
  });
const seedMarker = (env: RulesTestEnvironment, uid: string, key: string, itemId: string) =>
  env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `users/${uid}/articleMarkers/${key}`), {
      key,
      itemId,
      source: 'trigger',
    });
  });

describe('articleMarkers (users/{uid}/articleMarkers/{key})', () => {
  // ── reads ────────────────────────────────────────────────────────────────

  it('owner can read their own marker (seeded via bypass)', async () => {
    await seedMarker(committed, OWNER, 'shared1', 'item1');
    await assertSucceeds(getDoc(doc(ownerDb(), `users/${OWNER}/articleMarkers/shared1`)));
  });

  // ── (c) no corresponding article doc → denied (minting attack) ──────────
  // (c), (d) and (e) run with the grace period open, so only the rule under
  // test refuses them.

  it('(c) owner creating a marker with NO corresponding users/{uid}/articles doc is denied', async () => {
    await assertFails(
      setDoc(doc(ownerDb(graceOpen), `users/${OWNER}/articleMarkers/article-ghost`), {
        key: 'article-ghost',
        itemId: 'article-ghost',
        source: 'sync',
      }),
    );
  });

  it('(c) owner creating a marker with an itemId that references a non-existent article is denied', async () => {
    await assertFails(
      setDoc(doc(ownerDb(graceOpen), `users/${OWNER}/articleMarkers/resolved-ghost`), {
        key: 'resolved-ghost',
        itemId: 'article-ghost', // article-ghost does not exist
        source: 'sync',
      }),
    );
  });

  // ── (d) marker missing the itemId field → denied ─────────────────────────

  it('(d) owner creating a marker that is missing the itemId field is denied', async () => {
    // The article links to the marker key, so only the missing field refuses it.
    await seedUserArticle(graceOpen, OWNER, 'item1', { title: 'hello', canonicalId: 'shared1' });
    await assertFails(
      setDoc(doc(ownerDb(graceOpen), `users/${OWNER}/articleMarkers/shared1`), {
        key: 'shared1',
        // itemId intentionally omitted
        source: 'sync',
      }),
    );
  });

  // ── (e) cross-user isolation ─────────────────────────────────────────────

  it('(e) a different signed-in user cannot read the owner marker', async () => {
    await seedMarker(committed, OWNER, 'shared1', 'item1');
    await assertFails(getDoc(doc(otherDb(), `users/${OWNER}/articleMarkers/shared1`)));
  });

  it('(e) a different signed-in user cannot write to the owner marker path', async () => {
    // OWNER's article links to the marker key, so the only barrier is the uid.
    await seedUserArticle(graceOpen, OWNER, 'item1', { title: 'hello', canonicalId: 'shared1' });
    await assertFails(
      setDoc(doc(otherDb(graceOpen), `users/${OWNER}/articleMarkers/shared1`), {
        key: 'shared1',
        itemId: 'item1',
        source: 'sync',
      }),
    );
  });

  it('(e) an unauthenticated user cannot read or write a marker', async () => {
    await seedUserArticle(graceOpen, OWNER, 'item1', { title: 'hello', canonicalId: 'shared1' });
    const ref = doc(anonDb(graceOpen), `users/${OWNER}/articleMarkers/shared1`);
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, { key: 'shared1', itemId: 'item1', source: 'sync' }));
  });

  // ── delete ───────────────────────────────────────────────────────────────

  it('owner can delete their own marker', async () => {
    await seedMarker(committed, OWNER, 'shared1', 'item1');
    await assertSucceeds(deleteDoc(doc(ownerDb(), `users/${OWNER}/articleMarkers/shared1`)));
  });

  it('a different signed-in user cannot delete the owner marker', async () => {
    await seedMarker(committed, OWNER, 'shared1', 'item1');
    await assertFails(deleteDoc(doc(otherDb(), `users/${OWNER}/articleMarkers/shared1`)));
  });
});

describe('articleMarkers during the grace period (app-written marker must match canonicalId)', () => {
  const marker = (itemId: string, key: string) => ({ key, itemId, source: 'self-heal' });

  // ── accepted ─────────────────────────────────────────────────────────────

  it('owner creating a marker keyed by the article canonicalId is allowed', async () => {
    await seedUserArticle(graceOpen, OWNER, 'item1', { title: 'hello', canonicalId: 'shared1' });
    await assertSucceeds(
      setDoc(doc(ownerDb(graceOpen), `users/${OWNER}/articleMarkers/shared1`), marker('item1', 'shared1')),
    );
  });

  it('owner rewriting a server-written marker with a merge set is allowed (update)', async () => {
    await seedUserArticle(graceOpen, OWNER, 'item1', { title: 'hello', canonicalId: 'shared1' });
    await seedMarker(graceOpen, OWNER, 'shared1', 'item1');
    await assertSucceeds(
      setDoc(doc(ownerDb(graceOpen), `users/${OWNER}/articleMarkers/shared1`), marker('item1', 'shared1'), {
        merge: true,
      }),
    );
  });

  it('an anonymous-auth user writing a marker that matches its own article canonicalId is allowed', async () => {
    await seedUserArticle(graceOpen, ANON, 'item1', { title: 'hello', canonicalId: 'shared1' });
    await assertSucceeds(
      setDoc(doc(anonAuthDb(graceOpen), `users/${ANON}/articleMarkers/shared1`), marker('item1', 'shared1')),
    );
  });

  // ── refused ──────────────────────────────────────────────────────────────

  it('a marker keyed by a different id than the article canonicalId is denied', async () => {
    await seedUserArticle(graceOpen, OWNER, 'item1', { title: 'hello', canonicalId: 'shared1' });
    await assertFails(
      setDoc(doc(ownerDb(graceOpen), `users/${OWNER}/articleMarkers/shared2`), marker('item1', 'shared2')),
    );
  });

  it('a marker for an article the server has not linked yet (no canonicalId) is denied', async () => {
    await seedUserArticle(graceOpen, OWNER, 'item1', { title: 'hello' });
    await assertFails(
      setDoc(doc(ownerDb(graceOpen), `users/${OWNER}/articleMarkers/item1`), marker('item1', 'item1')),
    );
  });

  it('a batch that creates the article and an itemId-keyed marker together is denied', async () => {
    // The backup batch of older app builds.
    const db = ownerDb(graceOpen);
    const batch = writeBatch(db);
    batch.set(doc(db, `users/${OWNER}/articles/item1`), { title: 'hello' });
    batch.set(doc(db, `users/${OWNER}/articleMarkers/item1`), marker('item1', 'item1'));
    await assertFails(batch.commit());
  });

  // ── the leak, closed ─────────────────────────────────────────────────────

  describe('another user cannot link to the owner shared article', () => {
    const seedOwnerLink = async () => {
      await seedSharedArticle(graceOpen, 'shared1', { title: 'owner archive' });
      await seedUserArticle(graceOpen, OWNER, 'item1', { title: 'hello', canonicalId: 'shared1' });
      await seedMarker(graceOpen, OWNER, 'shared1', 'item1');
    };

    it('creating an own article named like the shared id plus a marker in one batch is denied', async () => {
      await seedOwnerLink();
      const db = otherDb(graceOpen);
      const batch = writeBatch(db);
      batch.set(doc(db, `users/${OTHER}/articles/shared1`), { title: 'bait' });
      batch.set(doc(db, `users/${OTHER}/articleMarkers/shared1`), marker('shared1', 'shared1'));
      await assertFails(batch.commit());
      await assertFails(getDoc(doc(otherDb(graceOpen), 'articles/shared1')));
    });

    it('writing canonicalId on an own article to match the shared id is denied', async () => {
      await seedOwnerLink();
      const db = otherDb(graceOpen);
      const batch = writeBatch(db);
      batch.set(doc(db, `users/${OTHER}/articles/item9`), { title: 'bait', canonicalId: 'shared1' });
      batch.set(doc(db, `users/${OTHER}/articleMarkers/shared1`), marker('item9', 'shared1'));
      await assertFails(batch.commit());
      await assertFails(getDoc(doc(otherDb(graceOpen), 'articles/shared1')));
    });
  });
});

describe.each([
  ['grace ended', () => graceEnded],
  ['committed rules (no grace)', () => committed],
])('articleMarkers after the grace end: %s', (_name, envOf) => {
  const marker = { key: 'shared1', itemId: 'item1', source: 'self-heal' };

  it('the owner cannot write a marker, even one that matches canonicalId', async () => {
    const env = envOf();
    await seedUserArticle(env, OWNER, 'item1', { title: 'hello', canonicalId: 'shared1' });
    await assertFails(setDoc(doc(ownerDb(env), `users/${OWNER}/articleMarkers/shared1`), marker));
  });

  it('an anonymous-auth user cannot write a marker, even one that matches canonicalId', async () => {
    const env = envOf();
    await seedUserArticle(env, ANON, 'item1', { title: 'hello', canonicalId: 'shared1' });
    await assertFails(setDoc(doc(anonAuthDb(env), `users/${ANON}/articleMarkers/shared1`), marker));
  });

  it('an unauthenticated user cannot write a marker', async () => {
    const env = envOf();
    await seedUserArticle(env, OWNER, 'item1', { title: 'hello', canonicalId: 'shared1' });
    await assertFails(setDoc(doc(anonDb(env), `users/${OWNER}/articleMarkers/shared1`), marker));
  });

  it('a server-written marker lets the owner read the shared article, and no one else', async () => {
    const env = envOf();
    await seedSharedArticle(env, 'shared1', { title: 'archive' });
    await seedUserArticle(env, OWNER, 'item1', { title: 'hello', canonicalId: 'shared1' });
    await seedMarker(env, OWNER, 'shared1', 'item1');
    await assertSucceeds(getDoc(doc(ownerDb(env), 'articles/shared1')));
    await assertFails(getDoc(doc(otherDb(env), 'articles/shared1')));
  });
});

describe('user articles: canonicalId is server-owned (users/{uid}/articles/{id})', () => {
  const path = `users/${OWNER}/articles/item1`;
  const seedLinked = () =>
    seedUserArticle(committed, OWNER, 'item1', { title: 'hello', resolvedId: 'shared1', canonicalId: 'shared1' });

  it('creating an article with canonicalId is denied', async () => {
    await assertFails(setDoc(doc(ownerDb(), path), { title: 'hello', canonicalId: 'shared1' }));
  });

  it('creating an article without canonicalId is allowed', async () => {
    await assertSucceeds(setDoc(doc(ownerDb(), path), { title: 'hello' }));
  });

  it('a merge update of other fields on a linked article is allowed', async () => {
    await seedLinked();
    await assertSucceeds(setDoc(doc(ownerDb(), path), { title: 'renamed' }, { merge: true }));
  });

  it('a whole-article merge write that carries resolvedId (older app builds) is allowed', async () => {
    await seedLinked();
    await assertSucceeds(
      setDoc(
        doc(ownerDb(), path),
        { title: 'hello', url: 'https://example.com/a', resolvedId: 'item1', timeUpdated: 2 },
        { merge: true },
      ),
    );
  });

  it('a soft-delete merge write (deletedAt, timeUpdated, legacy deleted_at removed) is allowed', async () => {
    await seedUserArticle(committed, OWNER, 'item1', {
      title: 'hello',
      canonicalId: 'shared1',
      deleted_at: 1,
    });
    await assertSucceeds(
      setDoc(doc(ownerDb(), path), { deletedAt: 5, timeUpdated: 5, deleted_at: deleteField() }, { merge: true }),
    );
  });

  it('changing canonicalId is denied', async () => {
    await seedLinked();
    await assertFails(setDoc(doc(ownerDb(), path), { canonicalId: 'shared2' }, { merge: true }));
  });

  it('a set without merge (which removes canonicalId) is denied', async () => {
    await seedLinked();
    await assertFails(setDoc(doc(ownerDb(), path), { title: 'hello' }));
  });

  it('adding canonicalId to an article that lacks it is denied', async () => {
    await seedUserArticle(committed, OWNER, 'item1', { title: 'hello' });
    await assertFails(setDoc(doc(ownerDb(), path), { canonicalId: 'shared1' }, { merge: true }));
  });

  it('another user cannot update the owner article', async () => {
    await seedLinked();
    await assertFails(setDoc(doc(otherDb(), path), { title: 'intruder' }, { merge: true }));
  });

  it('the owner can delete a linked article', async () => {
    await seedLinked();
    await assertSucceeds(deleteDoc(doc(ownerDb(), path)));
  });
});

describe('debug_logs (debug_logs/{uid}/sessions/{sessionId})', () => {
  it('owner can write then read their own session doc', async () => {
    const db = ownerDb();
    const ref = doc(db, `debug_logs/${OWNER}/sessions/sess-1_article-1`);
    await assertSucceeds(setDoc(ref, { sessionId: 'sess-1', events: [] }));
    await assertSucceeds(getDoc(ref));
  });

  it('a user cannot access another user session doc', async () => {
    await committed.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), `debug_logs/${OWNER}/sessions/sess-1_article-1`),
        { sessionId: 'sess-1', events: [] },
      );
    });
    const db = otherDb();
    const ref = doc(db, `debug_logs/${OWNER}/sessions/sess-1_article-1`);
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, { sessionId: 'sess-1', events: [] }));
  });

  it('the legacy flat debug_logs/{sessionId} layout is denied by default', async () => {
    const db = ownerDb();
    const ref = doc(db, 'debug_logs/legacy-session');
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, { sessionId: 'legacy-session' }));
  });
});

describe('articles (top-level get/list/write matrix)', () => {
  // Seed a top-level article and (optionally) the owner's server-written marker for it.
  const seedArticle = async (itemId: string, withOwnerMarker: boolean) => {
    await seedSharedArticle(committed, itemId, { title: 'hello' });
    if (withOwnerMarker) await seedMarker(committed, OWNER, itemId, 'item1');
  };

  it('get: owner WITH a marker can read the article', async () => {
    // Seed BOTH the article and the marker — a marker without the article would
    // "pass" the rule but return an empty read, which is not a meaningful success.
    await seedArticle('article-1', true);
    await assertSucceeds(getDoc(doc(ownerDb(), 'articles/article-1')));
  });

  it('get: owner WITHOUT a marker is denied', async () => {
    await seedArticle('article-2', false);
    await assertFails(getDoc(doc(ownerDb(), 'articles/article-2')));
  });

  it('get: a different signed-in user (no marker) is denied', async () => {
    await seedArticle('article-1', true); // owner's marker exists, other's does not
    await assertFails(getDoc(doc(otherDb(), 'articles/article-1')));
  });

  it('get: an anonymous-auth user (no marker) is denied', async () => {
    await seedArticle('article-1', false);
    await assertFails(getDoc(doc(anonAuthDb(), 'articles/article-1')));
  });

  it('get: an unauthenticated user is denied', async () => {
    await seedArticle('article-1', false);
    await assertFails(getDoc(doc(anonDb(), 'articles/article-1')));
  });

  it('get: a merged stub is readable with a server marker for it', async () => {
    await seedSharedArticle(committed, 'loser1', { title: 'hello', mergedInto: 'winner1' });
    await seedMarker(committed, OWNER, 'loser1', 'item1');
    await assertSucceeds(getDoc(doc(ownerDb(), 'articles/loser1')));
  });

  it('get: a merged stub is denied without a marker', async () => {
    await seedSharedArticle(committed, 'loser1', { title: 'hello', mergedInto: 'winner1' });
    await assertFails(getDoc(doc(otherDb(), 'articles/loser1')));
  });

  it('list: collection queries are denied for every actor', async () => {
    await seedArticle('article-1', true);
    await assertFails(getDocs(collection(ownerDb(), 'articles')));
    await assertFails(getDocs(collection(anonAuthDb(), 'articles')));
    await assertFails(getDocs(collection(anonDb(), 'articles')));
  });

  it('list: a signed-in non-owner (no marker) is denied a collection query', async () => {
    await seedArticle('article-1', true); // owner has a marker; OTHER does not
    await assertFails(getDocs(collection(otherDb(), 'articles')));
  });

  it('write: client writes to articles stay denied', async () => {
    await assertFails(setDoc(doc(ownerDb(), 'articles/article-1'), { title: 'nope' }));
  });
});

describe('article subcollections (text + domain_metadata)', () => {
  // Regression lock for the missing-subcollection-rule defect: Firestore rules
  // do not cascade from users/{uid}/articles/{articleId} to its subcollections,
  // so text/content and domain_metadata each need their own owner-scoped match.
  // Owner read+write must succeed; a different signed-in user must be denied.

  const TEXT_PATH = `users/${OWNER}/articles/article-1/text/content`;
  const META_PATH = `users/${OWNER}/articles/article-1/domain_metadata/metadata`;

  // ── text/content (headline fix) ────────────────────────────────────────────

  it('owner can write then read their own article text/content', async () => {
    const db = ownerDb();
    const ref = doc(db, TEXT_PATH);
    await assertSucceeds(setDoc(ref, { text: 'the full article body' }));
    await assertSucceeds(getDoc(ref));
  });

  it('a different signed-in user cannot read the owner text/content', async () => {
    await committed.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), TEXT_PATH), { text: 'the full article body' });
    });
    await assertFails(getDoc(doc(otherDb(), TEXT_PATH)));
  });

  it('a different signed-in user cannot write the owner text/content', async () => {
    await assertFails(setDoc(doc(otherDb(), TEXT_PATH), { text: 'intruder' }));
  });

  it('an unauthenticated user cannot read or write text/content', async () => {
    const ref = doc(anonDb(), TEXT_PATH);
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, { text: 'intruder' }));
  });

  // ── domain_metadata (snake_case gap the sibling audit uncovered) ────────────

  it('owner can write then read their own article domain_metadata', async () => {
    const db = ownerDb();
    const ref = doc(db, META_PATH);
    await assertSucceeds(setDoc(ref, { domain: 'example.com' }));
    await assertSucceeds(getDoc(ref));
  });

  it('a different signed-in user cannot read the owner domain_metadata', async () => {
    await committed.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), META_PATH), { domain: 'example.com' });
    });
    await assertFails(getDoc(doc(otherDb(), META_PATH)));
  });

  it('a different signed-in user cannot write the owner domain_metadata', async () => {
    await assertFails(setDoc(doc(otherDb(), META_PATH), { domain: 'evil.com' }));
  });

  it('an unauthenticated user cannot read or write domain_metadata', async () => {
    const ref = doc(anonDb(), META_PATH);
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, { domain: 'evil.com' }));
  });
});

describe('storage: archives stay denied to every client', () => {
  const contexts = () => [
    ['owner', committed.authenticatedContext(OWNER).storage()],
    ['anonymous-auth', committed.authenticatedContext(ANON, { firebase: { sign_in_provider: 'anonymous' } }).storage()],
    ['unauthenticated', committed.unauthenticatedContext().storage()],
  ] as const;

  it('reads and writes under archives/ are denied', async () => {
    for (const [, storage] of contexts()) {
      const ref = storage.ref('archives/shared1/readability.html');
      await assertFails(ref.getMetadata());
      await assertFails(ref.putString('x').then());
    }
  });

  it('reads and writes outside archives/ fall to the default deny', async () => {
    for (const [, storage] of contexts()) {
      const ref = storage.ref('other/file.txt');
      await assertFails(ref.getMetadata());
      await assertFails(ref.putString('x').then());
    }
  });
});

describe('committed firestore.rules: grace end placeholder', () => {
  const STAMPED = /timestamp\.value\(\s*[1-9]/;

  it('holds the grace placeholder exactly once and no stamped date', () => {
    const source = readCommittedFirestoreRules();
    expect(countPlaceholders(source)).toBe(1);
    expect(source).not.toMatch(STAMPED);
  });

  it('stampGraceEnd refuses a source without the placeholder or with two', () => {
    const source = readCommittedFirestoreRules();
    expect(() => stampGraceEnd('rules_version = "2";', Date.now())).toThrow();
    expect(() => stampGraceEnd(source + source, Date.now())).toThrow();
  });

  it('stampGraceEnd refuses an end that is not a positive integer', () => {
    const source = readCommittedFirestoreRules();
    expect(() => stampGraceEnd(source, 0)).toThrow();
    expect(() => stampGraceEnd(source, -1)).toThrow();
    expect(() => stampGraceEnd(source, 1.5)).toThrow();
  });

  it('a stamped source has no placeholder and exactly one stamped end', () => {
    const stamped = stampGraceEnd(readCommittedFirestoreRules(), 1_900_000_000_000);
    expect(countPlaceholders(stamped)).toBe(0);
    expect(stamped.split('timestamp.value(1900000000000); // __GRACE_END_MS__').length - 1).toBe(1);
    expect(stamped.match(/timestamp\.value\(/g)).toHaveLength(1);
  });
});
