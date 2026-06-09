import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

const PROJECT_ID = 'demo-trails';
const OWNER = 'owner-uid';
const OTHER = 'other-uid';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(here, '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

const ownerDb = () => testEnv.authenticatedContext(OWNER).firestore();
const otherDb = () => testEnv.authenticatedContext(OTHER).firestore();
const anonDb = () => testEnv.unauthenticatedContext().firestore();
// Signed-in but via Anonymous Auth (request.auth != null, sign_in_provider 'anonymous').
const anonAuthDb = () =>
  testEnv
    .authenticatedContext('anon-uid', { firebase: { sign_in_provider: 'anonymous' } })
    .firestore();

describe('articleMarkers (users/{uid}/articleMarkers/{key})', () => {
  // ── reads ────────────────────────────────────────────────────────────────

  it('owner can read their own marker (seeded via bypass)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${OWNER}/articleMarkers/article-1`), {
        key: 'article-1',
        itemId: 'article-1',
        source: 'sync',
      });
    });
    const db = ownerDb();
    await assertSucceeds(getDoc(doc(db, `users/${OWNER}/articleMarkers/article-1`)));
  });

  // ── (a) batch write: article doc + marker in same batch → allowed ────────

  it('(a) owner creating a marker WITH its owned article written in the same batch is allowed', async () => {
    const db = ownerDb();
    const batch = writeBatch(db);
    // Article doc written first in the batch (mirrors FirestoreBackupService order).
    batch.set(doc(db, `users/${OWNER}/articles/article-1`), { title: 'hello' });
    // itemId-keyed marker in the same batch.
    batch.set(doc(db, `users/${OWNER}/articleMarkers/article-1`), {
      key: 'article-1',
      itemId: 'article-1',
      source: 'sync',
    });
    await assertSucceeds(batch.commit());
  });

  it('(a) batch: resolvedId-keyed marker whose data.itemId points at the article in the same batch is allowed', async () => {
    const db = ownerDb();
    const batch = writeBatch(db);
    batch.set(doc(db, `users/${OWNER}/articles/article-1`), { title: 'hello' });
    // resolvedId-keyed marker — different doc id, but same itemId value.
    batch.set(doc(db, `users/${OWNER}/articleMarkers/resolved-1`), {
      key: 'resolved-1',
      itemId: 'article-1',
      source: 'sync',
    });
    await assertSucceeds(batch.commit());
  });

  // ── (b) pre-existing article doc → allowed (self-heal shape) ────────────

  it('(b) owner creating a marker when the article doc already exists (self-heal) is allowed', async () => {
    // Seed the article doc bypassing rules.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${OWNER}/articles/article-1`), {
        title: 'hello',
      });
    });
    const db = ownerDb();
    await assertSucceeds(
      setDoc(doc(db, `users/${OWNER}/articleMarkers/article-1`), {
        key: 'article-1',
        itemId: 'article-1',
        source: 'self-heal',
      }),
    );
  });

  it('(b) resolvedId-keyed marker whose data.itemId points at a pre-existing article is allowed', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${OWNER}/articles/article-1`), {
        title: 'hello',
      });
    });
    const db = ownerDb();
    await assertSucceeds(
      setDoc(doc(db, `users/${OWNER}/articleMarkers/resolved-1`), {
        key: 'resolved-1',
        itemId: 'article-1',
        source: 'self-heal',
      }),
    );
  });

  // ── (c) no corresponding article doc → denied (minting attack) ──────────

  it('(c) owner creating a marker with NO corresponding users/{uid}/articles doc is denied', async () => {
    const db = ownerDb();
    await assertFails(
      setDoc(doc(db, `users/${OWNER}/articleMarkers/article-ghost`), {
        key: 'article-ghost',
        itemId: 'article-ghost',
        source: 'sync',
      }),
    );
  });

  it('(c) owner creating a marker with an itemId that references a non-existent article is denied', async () => {
    const db = ownerDb();
    await assertFails(
      setDoc(doc(db, `users/${OWNER}/articleMarkers/resolved-ghost`), {
        key: 'resolved-ghost',
        itemId: 'article-ghost', // article-ghost does not exist
        source: 'sync',
      }),
    );
  });

  // ── (d) marker missing the itemId field → denied ─────────────────────────

  it('(d) owner creating a marker that is missing the itemId field is denied', async () => {
    // Seed article so only the missing-field check determines the outcome.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${OWNER}/articles/article-1`), {
        title: 'hello',
      });
    });
    const db = ownerDb();
    await assertFails(
      setDoc(doc(db, `users/${OWNER}/articleMarkers/article-1`), {
        key: 'article-1',
        // itemId intentionally omitted
        source: 'sync',
      }),
    );
  });

  // ── (e) cross-user isolation ─────────────────────────────────────────────

  it('(e) a different signed-in user cannot read the owner marker', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${OWNER}/articleMarkers/article-1`), {
        key: 'article-1',
        itemId: 'article-1',
        source: 'sync',
      });
    });
    const db = otherDb();
    await assertFails(getDoc(doc(db, `users/${OWNER}/articleMarkers/article-1`)));
  });

  it('(e) a different signed-in user cannot write to the owner marker path', async () => {
    // Seed OWNER's article so the only barrier is the userId mismatch.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${OWNER}/articles/article-1`), {
        title: 'hello',
      });
    });
    const db = otherDb();
    await assertFails(
      setDoc(doc(db, `users/${OWNER}/articleMarkers/article-1`), {
        key: 'article-1',
        itemId: 'article-1',
        source: 'sync',
      }),
    );
  });

  it('(e) an unauthenticated user cannot read or write a marker', async () => {
    const db = anonDb();
    const ref = doc(db, `users/${OWNER}/articleMarkers/article-1`);
    await assertFails(getDoc(ref));
    await assertFails(
      setDoc(ref, { key: 'article-1', itemId: 'article-1', source: 'sync' }),
    );
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
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
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
  // Seed a top-level article and (optionally) the owner's existence marker for it.
  const seedArticle = (itemId: string, withOwnerMarker: boolean) =>
    testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, `articles/${itemId}`), { title: 'hello' });
      if (withOwnerMarker) {
        await setDoc(doc(db, `users/${OWNER}/articleMarkers/${itemId}`), {
          key: itemId,
          source: 'backfill',
        });
      }
    });

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
