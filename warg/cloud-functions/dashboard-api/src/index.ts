import { initializeApp, getApps } from 'firebase-admin/app';
import { onRequest } from 'firebase-functions/v2/https';
import { verifyApiKey } from './auth.js';
import { verifyFirebaseToken } from './firebase-auth.js';
import { handleListArticles } from './list-articles.js';
import { handleGetArticle } from './get-article.js';
import { handleSignedUrl } from './signed-url.js';
import { handleAppSignedUrl } from './app-signed-url.js';
import { handleEnqueueArticle } from './enqueue-article.js';
import { handleBootstrapArticle } from './bootstrap-article.js';
import { handleMarkProcessing } from './mark-processing.js';

// Initialize Firebase Admin
if (getApps().length === 0) {
  initializeApp();
}

/**
 * Dashboard API — single onRequest function with path-based routing.
 *
 * Routes:
 *   GET /articles           → list articles with filters
 *   GET /articles/:itemId   → article detail (Milestone 2)
 *   POST /articles/enqueue  → enqueue user article for trigger-based archival
 *   POST /articles/:itemId/bootstrap       → ensure canonical article bootstrap fields
 *   POST /articles/:itemId/mark-processing → set canonical processing state + request id
 *   GET /signed-url         → signed GCS download URL (Milestone 3)
 *   GET /app/signed-url     → per-user signed GCS download URL (Firebase ID token auth)
 */
export const dashboardApi = onRequest(
  { cors: true, memory: '1GiB', maxInstances: 20, timeoutSeconds: 120 },
  async (req, res) => {
    // Per-user signed-URL lane (Firebase ID token, NOT the internal API key).
    // Matched ahead of the verifyApiKey wrapper so app users never need the
    // internal key. Only an exact `GET /app/signed-url` lands here; every other
    // path falls through to the API-key-protected dashboard routes below.
    const appPath = req.path.replace(/^\/+|\/+$/g, '');
    if (req.method === 'GET' && appPath === 'app/signed-url') {
      verifyFirebaseToken(req, res, (uid) => handleAppSignedUrl(req, res, uid)).catch((err) => {
        console.error('[dashboard-api] Unhandled /app/signed-url error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal server error' });
        }
      });
      return;
    }

    // Auth middleware
    verifyApiKey(req, res, () => {
      void (async () => {
        const path = req.path.replace(/^\/+|\/+$/g, '');
        const segments = path.split('/');

        if (segments[0] === 'articles') {
          if (req.method === 'GET' && segments.length === 1) {
            await handleListArticles(req, res);
            return;
          }

          if (req.method === 'POST' && segments.length === 2 && segments[1] === 'enqueue') {
            await handleEnqueueArticle(req, res);
            return;
          }

          if (req.method === 'GET' && segments.length === 2 && segments[1]) {
            await handleGetArticle(req, res, segments[1]);
            return;
          }

          if (req.method === 'POST' && segments.length === 3 && segments[1] && segments[2] === 'bootstrap') {
            await handleBootstrapArticle(req, res, segments[1]);
            return;
          }

          if (
            req.method === 'POST' &&
            segments.length === 3 &&
            segments[1] &&
            segments[2] === 'mark-processing'
          ) {
            await handleMarkProcessing(req, res, segments[1]);
            return;
          }
        }

        // GET /signed-url?itemId=X&archiveKey=Y
        if (req.method === 'GET' && segments[0] === 'signed-url') {
          await handleSignedUrl(req, res);
          return;
        }

        res.status(404).json({ error: 'Not found' });
      })().catch((err) => {
        console.error('[dashboard-api] Unhandled routing error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal server error' });
        }
      });
    });
  }
);
