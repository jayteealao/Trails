import type { HttpFunction } from '@google-cloud/functions-framework';
import { initializeApp, getApps } from 'firebase-admin/app';
import { verifyApiKey } from './auth.js';
import { handleCreateUpload } from './create-upload.js';
import { handleFinalize } from './finalize.js';

// Initialize Firebase Admin (only once)
if (getApps().length === 0) {
  initializeApp({
    projectId: process.env['FIRESTORE_PROJECT_ID'] ?? 'trails-e428e'
  });
}

/**
 * Main HTTP function handler.
 * Routes requests to appropriate handlers based on path.
 */
export const handleRequest: HttpFunction = (req, res) => {
  // No CORS headers — this is an internal API called only by backend workers.
  // Reject preflight and non-POST methods.

  // Only allow POST
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Verify API key
  verifyApiKey(req, res, () => {
    const path = req.path;
    console.log(`[gateway] Handling ${req.method} ${path}`);

    switch (path) {
      case '/create-upload':
        handleCreateUpload(req, res);
        break;
      case '/finalize':
        handleFinalize(req, res);
        break;
      default:
        res.status(404).json({ error: 'Not found', path });
    }
  });
};
