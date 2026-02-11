import { initializeApp, getApps } from 'firebase-admin/app';
import { onRequest } from 'firebase-functions/v2/https';
import { verifyApiKey } from './auth.js';
import { handleListArticles } from './list-articles.js';
import { handleGetArticle } from './get-article.js';
import { handleSignedUrl } from './signed-url.js';

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
 *   GET /signed-url         → signed GCS download URL (Milestone 3)
 */
export const dashboardApi = onRequest(
  { cors: true, memory: '1GiB', maxInstances: 20, timeoutSeconds: 120 },
  async (req, res) => {
    // Auth middleware
    verifyApiKey(req, res, () => {
      try {
        // Route based on path
        const path = req.path.replace(/^\/+|\/+$/g, '');
        const segments = path.split('/');

        if (req.method === 'GET' && segments[0] === 'articles') {
          if (segments.length === 1) {
            // GET /articles
            handleListArticles(req, res).catch((err) => {
              console.error('[dashboard-api] Error in handleListArticles:', err);
              res.status(500).json({ error: 'Internal server error' });
            });
            return;
          }

          // GET /articles/:itemId
          if (segments.length === 2 && segments[1]) {
            handleGetArticle(req, res, segments[1]).catch((err) => {
              console.error('[dashboard-api] Error in handleGetArticle:', err);
              res.status(500).json({ error: 'Internal server error' });
            });
            return;
          }
        }

        // GET /signed-url?itemId=X&archiveKey=Y
        if (req.method === 'GET' && segments[0] === 'signed-url') {
          handleSignedUrl(req, res).catch((err) => {
            console.error('[dashboard-api] Error in handleSignedUrl:', err);
            res.status(500).json({ error: 'Internal server error' });
          });
          return;
        }

        res.status(404).json({ error: 'Not found' });
      } catch (err) {
        console.error('[dashboard-api] Unhandled routing error:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  }
);
