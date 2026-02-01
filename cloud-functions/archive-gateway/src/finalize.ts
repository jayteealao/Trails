import type { Request, Response } from '@google-cloud/functions-framework';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import type {
  FinalizeRequest,
  FinalizeResponse,
  ArchiveEntry
} from './types.js';
import { KIND_TO_ARCHIVE_KEY } from './types.js';
import { logEvent } from './logging.js';

const GCS_BUCKET = process.env['GCS_BUCKET'] ?? 'htbase-archives-standard';

/**
 * Handler for POST /finalize.
 * Updates Firestore document with successful upload metadata.
 */
export async function handleFinalize(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const body = req.body as FinalizeRequest;

    // Validate request
    if (!body.request_id || !body.firestore_doc_id || !body.uploaded || !Array.isArray(body.uploaded)) {
      res.status(400).json({
        error: 'Missing required fields: request_id, firestore_doc_id, uploaded'
      });
      return;
    }

    const { request_id, firestore_doc_id, uploaded } = body;
    console.log(`[finalize] Processing ${uploaded.length} uploaded artifacts for ${request_id}`);

    const db = getFirestore();
    const docRef = db.collection('articles').doc(firestore_doc_id);

    // Build update object for archives
    const updates: Record<string, ArchiveEntry> = {};

    for (const artifact of uploaded) {
      const archiveKey = KIND_TO_ARCHIVE_KEY[artifact.kind];
      if (!archiveKey) {
        console.warn(`[finalize] Unknown artifact kind: ${artifact.kind}, skipping`);
        continue;
      }

      updates[archiveKey] = {
        status: 'success',
        gcs_path: `gs://${GCS_BUCKET}/${artifact.gcs_path}`,
        gcs_bucket: GCS_BUCKET,
        file_size: artifact.bytes,
        sha256: artifact.sha256,
        content_type: artifact.content_type
      };

      console.log(`[finalize] Updated ${archiveKey} with success status`);
    }

    // Update Firestore document
    await docRef.update({
      ...Object.fromEntries(
        Object.entries(updates).map(([key, value]) => [`archives.${key}`, value])
      ),
      updated_at: Timestamp.now()
    });

    console.log(`[finalize] Firestore document updated: ${firestore_doc_id}`);

    // Log persist.completed event
    await logEvent(
      request_id,
      'gcs',
      'persist.completed',
      'Firestore finalized',
      { firestoreDocId: firestore_doc_id, artifactCount: uploaded.length }
    );

    const response: FinalizeResponse = {
      success: true,
      firestore_doc_id,
      status: 'done'
    };

    res.status(200).json(response);
  } catch (err) {
    console.error('[finalize] Error:', err);
    const message = err instanceof Error ? err.message : String(err);

    // Log persist.failed event (request_id may not be available if parsing failed)
    const reqBody = req.body as Partial<FinalizeRequest>;
    if (reqBody?.request_id) {
      await logEvent(
        reqBody.request_id,
        'gcs',
        'persist.failed',
        `Failed to finalize: ${message}`,
        { error: message },
        'error'
      );
    }

    res.status(500).json({ error: 'Internal error', message });
  }
}
