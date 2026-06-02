import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import type { DocumentData } from 'firebase-admin/firestore';
import { deriveStatus } from './article-status.js';

/**
 * Firestore trigger that owns the `status` field on every `articles/{id}`
 * document. Status is derived from the document's archives map, retry count,
 * and failure block — every other writer should leave `status` alone.
 *
 * Loop guard: after the trigger writes the derived value, the next invocation
 * sees `after.status === derived` and returns early — worst case is one extra
 * fire per real change.
 */
export const articleStatusDerive = onDocumentWritten(
  {
    document: 'articles/{id}',
    region: 'us-central1',
    retry: false,
  },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;

    const doc = after.data() as DocumentData | undefined;
    if (!doc) return;

    const derived = deriveStatus(doc, Date.now());
    const currentStatus = typeof doc['status'] === 'string' ? doc['status'] : undefined;

    if (currentStatus === derived) return;

    await after.ref.set(
      {
        status: derived,
        status_updated_at: Timestamp.now(),
      },
      { merge: true }
    );
  }
);
