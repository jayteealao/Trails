import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
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

describe('articleMarkers (users/{uid}/articleMarkers/{key})', () => {
  it('owner can write then read their own marker', async () => {
    const db = ownerDb();
    const ref = doc(db, `users/${OWNER}/articleMarkers/article-1`);
    await assertSucceeds(setDoc(ref, { key: 'article-1', source: 'sync' }));
    await assertSucceeds(getDoc(ref));
  });

  it('a different signed-in user cannot read or write the owner marker', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `users/${OWNER}/articleMarkers/article-1`), {
        key: 'article-1',
        source: 'sync',
      });
    });
    const db = otherDb();
    const ref = doc(db, `users/${OWNER}/articleMarkers/article-1`);
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, { key: 'article-1', source: 'sync' }));
  });

  it('an unauthenticated user cannot read or write a marker', async () => {
    const db = anonDb();
    const ref = doc(db, `users/${OWNER}/articleMarkers/article-1`);
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, { key: 'article-1', source: 'sync' }));
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

describe('articles read rule (unchanged this slice)', () => {
  it('an authenticated user can still read a top-level article (deploy-safety)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'articles/article-1'), { title: 'hello' });
    });
    const db = ownerDb();
    await assertSucceeds(getDoc(doc(db, 'articles/article-1')));
    // The marker-gated get-only / `list: if false` tightening and its full
    // get/list matrix are a later, separately deployed change — not asserted here.
  });
});
