import type { Request, Response } from 'express';
import type { GetSignedUrlConfig } from '@google-cloud/storage';
import { Storage } from '@google-cloud/storage';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import type {
  CreateUploadRequest,
  CreateUploadResponse,
  UploadEntry,
  ArticleDocument,
  ArtifactKind,
  ArchiveEntry,
  ArtifactUploadInfo
} from './types.js';
import { GCS_PATH_CONFIG, KIND_TO_ARCHIVE_KEY } from './types.js';
import { logEvent } from './logging.js';

const GCS_BUCKET = process.env['GCS_BUCKET'] ?? 'htbase-archives-standard';
const SIGNED_URL_EXPIRY_MINUTES = 15;

/**
 * Get the GCS path for an artifact.
 */
function getGcsPath(requestId: string, kind: ArtifactKind): string {
  const config = GCS_PATH_CONFIG[kind];
  return `archives/${requestId}/${config.folder}/${config.filename}`;
}

/**
 * Extract domain from URL.
 */
function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return 'unknown';
  }
}

/**
 * Handler for POST /create-upload.
 * Creates Firestore document and returns signed upload URLs.
 */
export async function handleCreateUpload(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const body = req.body as CreateUploadRequest;

    // Validate request
    if (!body.request_id || !body.url || !body.artifacts || !Array.isArray(body.artifacts)) {
      res.status(400).json({
        error: 'Missing required fields: request_id, url, artifacts'
      });
      return;
    }

    const { request_id, url, artifacts } = body;
    console.log(`[create-upload] Processing ${artifacts.length} artifacts for ${request_id}`);

    // Log persist.started event
    await logEvent(
      request_id,
      'gcs',
      'persist.started',
      'Creating signed upload URLs',
      { artifactCount: artifacts.length }
    );

    // Initialize GCS and Firestore
    const storage = new Storage({
      projectId: process.env['GCS_PROJECT_ID'] ?? 'trails-414917'
    });
    const bucket = storage.bucket(GCS_BUCKET);
    const db = getFirestore();

    // Create initial archives map with pending status
    const archives: Record<string, ArchiveEntry> = {};
    for (const artifact of artifacts) {
      const archiveKey = KIND_TO_ARCHIVE_KEY[artifact.kind];
      archives[archiveKey] = {
        status: 'pending'
      };
    }

    // Create or update Firestore document
    const docRef = db.collection('articles').doc(request_id);
    const now = Timestamp.now();

    const docData: Partial<ArticleDocument> = {
      item_id: request_id,
      url,
      domain: extractDomain(url),
      updated_at: now,
      archives
    };

    // Check if document exists
    const existingDoc = await docRef.get();
    if (!existingDoc.exists) {
      docData.created_at = now;
    }

    await docRef.set(docData, { merge: true });
    console.log(`[create-upload] Firestore document created/updated: ${request_id}`);

    // Generate signed URLs for each artifact
    const uploads: UploadEntry[] = [];
    const expiresAt = new Date(Date.now() + SIGNED_URL_EXPIRY_MINUTES * 60 * 1000);

    for (const artifact of artifacts) {
      const gcsPath = getGcsPath(request_id, artifact.kind);
      const file = bucket.file(gcsPath);

      const signedUrlOptions: GetSignedUrlConfig = {
        version: 'v4',
        action: 'write',
        expires: expiresAt,
        contentType: artifact.contentType
      };

      // Include Content-Encoding header for compressed artifacts
      if (artifact.compressed) {
        signedUrlOptions.extensionHeaders = {
          'Content-Encoding': 'gzip'
        };
      }

      const [signedUrl] = await file.getSignedUrl(signedUrlOptions);

      uploads.push({
        kind: artifact.kind,
        signed_url: signedUrl,
        gcs_path: gcsPath,
        expires_at: expiresAt.toISOString()
      });

      console.log(`[create-upload] Generated signed URL for ${artifact.kind}${artifact.compressed ? ' [gzip]' : ''}`);
    }

    // Log persist.completed event
    await logEvent(
      request_id,
      'gcs',
      'persist.completed',
      'Signed URLs created',
      { firestoreDocId: request_id, uploadCount: uploads.length }
    );

    const response: CreateUploadResponse = {
      firestore_doc_id: request_id,
      uploads
    };

    res.status(200).json(response);
  } catch (err) {
    console.error('[create-upload] Error:', err);
    const message = err instanceof Error ? err.message : String(err);

    // Log persist.failed event (request_id may not be available if parsing failed)
    const reqBody = req.body as Partial<CreateUploadRequest>;
    if (reqBody?.request_id) {
      await logEvent(
        reqBody.request_id,
        'gcs',
        'persist.failed',
        `Failed to create upload URLs: ${message}`,
        { error: message },
        'error'
      );
    }

    res.status(500).json({ error: 'Internal error', message });
  }
}
