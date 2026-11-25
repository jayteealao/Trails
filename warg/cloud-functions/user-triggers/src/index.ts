import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { callGatewayBegin } from './gateway-client.js';
import { handleUserArticleCreated } from './handler.js';
import { handleArchiveRetry } from './retry.js';
import { PUBLIC_API_KEY, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET, gatewayBeginConfig } from './secrets.js';

// Initialize Firebase Admin
if (getApps().length === 0) {
  initializeApp();
}

// Environment params
const GATEWAY_URL = defineString('GATEWAY_URL', {
  default: 'https://gateway.jayteealao.workers.dev',
});

/**
 * Firestore trigger: when a user saves an article
 *
 * Trigger path: users/{userId}/articles/{itemId}
 * Event: onCreate
 */
export const onUserArticleSave = onDocumentCreated(
  {
    document: 'users/{userId}/articles/{itemId}',
    secrets: [PUBLIC_API_KEY, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET],
    // A failed link or archive start throws inside the handler's retry window,
    // so the event is delivered again instead of leaving the article unlinked.
    retry: true,
  },
  async (event) => {
    const snap = event.data;
    if (!snap) {
      console.log('No data in snapshot');
      return null;
    }

    const { userId, itemId } = event.params;
    await handleUserArticleCreated(
      { db: getFirestore(), userId, itemId, data: snap.data(), eventTimeMs: Date.parse(event.time) },
      { beginArchive: (payload) => callGatewayBegin(gatewayBeginConfig(GATEWAY_URL.value()), payload) }
    );
    return null;
  }
);

/**
 * Callable: a signed-in person archives an article they saved again.
 *
 * Takes { itemId } and answers { outcome, reason? } (see retry.ts).
 */
export const retryArchive = onCall(
  {
    secrets: [PUBLIC_API_KEY, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET],
    timeoutSeconds: 120,
    maxInstances: 5,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in to retry an archive');
    }
    const data: unknown = request.data;
    const itemId = typeof data === 'object' && data !== null && 'itemId' in data ? data.itemId : undefined;
    // Read before the claim, so a missing key fails with nothing claimed.
    const config = gatewayBeginConfig(GATEWAY_URL.value());
    return handleArchiveRetry(
      { db: getFirestore(), userId: request.auth.uid, itemId },
      { beginArchive: (payload) => callGatewayBegin(config, payload, 1) }
    );
  }
);
