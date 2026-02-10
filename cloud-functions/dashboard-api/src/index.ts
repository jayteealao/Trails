import { initializeApp, getApps } from 'firebase-admin/app';
import { onRequest } from 'firebase-functions/v2/https';
import { verifyApiKey } from './auth.js';
import { handleListArticles } from './list-articles.js';

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
  { cors: true },
  async (req, res) => {
    // Auth middleware
    verifyApiKey(req, res, () => {
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

        // GET /articles/:itemId (Milestone 2)
        if (segments.length === 2 && segments[1]) {
          res.status(501).json({ error: 'Article detail not yet implemented' });
          return;
        }
      }

      // GET /signed-url (Milestone 3)
      if (req.method === 'GET' && segments[0] === 'signed-url') {
        res.status(501).json({ error: 'Signed URL not yet implemented' });
        return;
      }

      res.status(404).json({ error: 'Not found' });
    });
  }
);
