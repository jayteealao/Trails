import process from 'node:process';

import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'demo-trails';

// Default to the shared emulator port when the suite is not launched via
// `firebase emulators:exec` (which sets FIRESTORE_EMULATOR_HOST itself). This
// keeps the integration suite cross-platform — no shell env-var prefix needed.
process.env['FIRESTORE_EMULATOR_HOST'] ??= '127.0.0.1:8080';
process.env['GCLOUD_PROJECT'] ??= PROJECT_ID;

let appCounter = 0;

export interface TestDb {
  readonly db: Firestore;
  readonly app: App;
}

/** A fresh Admin app + Firestore pointed at the emulator (no real credentials). */
export function createTestDb(): TestDb {
  const app = initializeApp({ projectId: PROJECT_ID }, `int-test-${appCounter++}`);
  return { db: getFirestore(app), app };
}

export async function destroyTestDb(testDb: TestDb): Promise<void> {
  await deleteApp(testDb.app);
}

/** Wipe all emulator data between tests via the emulator's REST endpoint. */
export async function clearEmulator(): Promise<void> {
  const host = process.env['FIRESTORE_EMULATOR_HOST'];
  const response = await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  if (!response.ok) {
    throw new Error(`clearEmulator failed: ${response.status} ${await response.text()}`);
  }
}
