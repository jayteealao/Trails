import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineString, defineSecret } from 'firebase-functions/params';
import { callGatewayBegin } from './gateway-client.js';

// Initialize Firebase Admin
if (getApps().length === 0) {
  initializeApp();
}

// Environment params
const GATEWAY_URL = defineString('GATEWAY_URL', {
  default: 'https://gateway.jayteealao.workers.dev',
});
const PUBLIC_API_KEY = defineString('PUBLIC_API_KEY');
const CF_ACCESS_CLIENT_ID = defineSecret('CF_ACCESS_CLIENT_ID');
const CF_ACCESS_CLIENT_SECRET = defineSecret('CF_ACCESS_CLIENT_SECRET');

/**
 * Extract domain from URL (hostname without www.)
 */
function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

/**
 * Firestore trigger: when a user saves an article
 *
 * Trigger path: users/{userId}/articles/{itemId}
 * Event: onCreate
 */
export const onUserArticleSave = onDocumentCreated(
  {
    document: 'users/{userId}/articles/{itemId}',
    secrets: [CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET],
  },
  async (event) => {
    const snap = event.data;
    if (!snap) {
      console.log('No data in snapshot');
      return null;
    }

    const { userId, itemId } = event.params;
    const userArticle = snap.data();
    const db = getFirestore();

    console.log(`[onUserArticleSave] Processing ${itemId} for user ${userId}`);

    // 1. Validate URL
    if (!userArticle['url']) {
      console.error(`Missing URL for article ${itemId}`);
      await snap.ref.update({
        error: 'Missing URL',
        error_at: Timestamp.now(),
      });
      return null;
    }

    const url = userArticle['url'] as string;

    try {
      // 2. Check for existing article by URL
      const existingQuery = await db
        .collection('articles')
        .where('url', '==', url)
        .limit(1)
        .get();

      if (!existingQuery.empty) {
        // 3a. Link to existing article
        const existingDoc = existingQuery.docs[0]!;
        console.log(
          `[onUserArticleSave] Found existing article ${existingDoc.id} for URL`
        );

        await existingDoc.ref.update({
          'stats.total_saves': FieldValue.increment(1),
          'stats.last_saved_at': Timestamp.now(),
        });

        await snap.ref.update({
          resolvedId: existingDoc.id,
        });

        return null;
      }

      // 3b. Create new shared article
      const domain = extractDomain(url);
      const pocket = {
        favorite: userArticle['favorite'] ?? '',
        resolved_id: userArticle['resolvedId'] ?? '',
        status: userArticle['status'] ?? '',
        time_added: userArticle['timeAdded'] ?? 0,
        time_read: userArticle['timeRead'] ?? 0,
      };

      const articleRef = db.collection('articles').doc(itemId);
      await articleRef.set({
        item_id: itemId,
        url,
        domain,
        created_at: Timestamp.now(),
        status: 'pending',
        archives: {},
        pocket,
        stats: {
          last_accessed: '',
          total_saves: 1,
          total_views: 0,
        },
      });

      console.log(`[onUserArticleSave] Created shared article ${itemId}`);

      // 4. Call Warg gateway /begin to trigger archival
      const { requestId } = await callGatewayBegin(
        {
          gatewayUrl: GATEWAY_URL.value(),
          publicApiKey: PUBLIC_API_KEY.value(),
          cfAccessClientId: process.env['CF_ACCESS_CLIENT_ID'] ?? '',
          cfAccessClientSecret: process.env['CF_ACCESS_CLIENT_SECRET'] ?? '',
        },
        {
          url,
          request_id: itemId,
          includeScreenshot: true,
          includePdf: true,
        }
      ) as { requestId: string };
      console.log(`[onUserArticleSave] Warg archive started: ${requestId}`);

      // 5. Update shared article with Warg request ID
      await articleRef.update({
        warg_request_id: requestId,
        status: 'processing',
        processing_started_at: Timestamp.now(),
      });

      // 6. Link user article to shared article
      await snap.ref.update({
        resolvedId: itemId,
        archival_triggered: true,
      });

      return null;
    } catch (error) {
      console.error(`[onUserArticleSave] Error processing ${itemId}:`, error);
      const message = error instanceof Error ? error.message : String(error);

      // Mark shared article as failed if it exists and is pending
      const articleRef = db.collection('articles').doc(itemId);
      const articleDoc = await articleRef.get();

      if (articleDoc.exists && articleDoc.data()?.['status'] === 'pending') {
        await articleRef.update({
          status: 'failed',
          error: message,
          failed_at: Timestamp.now(),
        });
      }

      // Mark user article with error
      await snap.ref.update({
        error: message,
        error_at: Timestamp.now(),
      });

      return null;
    }
  }
);
