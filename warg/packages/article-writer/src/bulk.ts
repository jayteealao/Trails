import {
  FieldPath,
  type BulkWriter,
  type DocumentData,
  type DocumentReference,
  type Timestamp,
  type WriteResult,
} from 'firebase-admin/firestore';
import type { SharedArticleField, UserArticleField } from './fields.js';
import { buildUserArticleCanonicalIdClearPatch, buildUserArticleLinkPatch } from './user-article.js';

// The write kinds the batch passes queue on a BulkWriter. Each makes the one
// BulkWriter call the pass has always made and returns its promise, so the pass
// keeps its own per-write error handling. A field-value kind names its field
// through a constant of the field list.

const ARCHIVES: SharedArticleField = 'archives';
const NORMALIZED_URL: SharedArticleField = 'normalizedUrl';
const MERGED_INTO: SharedArticleField = 'mergedInto';
const CANONICAL_ID: UserArticleField = 'canonicalId';

/**
 * Copies one archive entry of a merged duplicate onto the shared article. The
 * key is one FieldPath segment, so an archive key that contains a dot stays one key.
 */
export function copySharedArticleArchiveInBulk(
  writer: BulkWriter,
  ref: DocumentReference,
  archiveKey: string,
  entry: DocumentData
): Promise<WriteResult> {
  return writer.update(ref, new FieldPath(ARCHIVES, archiveKey), entry);
}

/** Sets the link lookup key of the shared article. */
export function setSharedArticleNormalizedUrlInBulk(
  writer: BulkWriter,
  ref: DocumentReference,
  normalizedUrl: string
): Promise<WriteResult> {
  return writer.update(ref, NORMALIZED_URL, normalizedUrl);
}

/** Marks a duplicate shared article as merged into its winner. */
export function markSharedArticleMergedInBulk(
  writer: BulkWriter,
  ref: DocumentReference,
  winnerId: string
): Promise<WriteResult> {
  return writer.update(ref, MERGED_INTO, winnerId);
}

/** Moves the server-owned link of a user article to the winner of a merge. */
export function moveUserArticleCanonicalIdInBulk(
  writer: BulkWriter,
  ref: DocumentReference,
  sharedId: string
): Promise<WriteResult> {
  return writer.update(ref, CANONICAL_ID, sharedId);
}

/** Links the user article to a shared article; fails with FAILED_PRECONDITION when it changed after `lastUpdateTime`. */
export function setUserArticleLinkInBulk(
  writer: BulkWriter,
  ref: DocumentReference,
  sharedId: string,
  lastUpdateTime: Timestamp
): Promise<WriteResult> {
  return writer.update(ref, buildUserArticleLinkPatch(sharedId), { lastUpdateTime });
}

/** Drops the link of the user article; fails with FAILED_PRECONDITION when it changed after `lastUpdateTime`. */
export function clearUserArticleCanonicalIdInBulk(
  writer: BulkWriter,
  ref: DocumentReference,
  lastUpdateTime: Timestamp
): Promise<WriteResult> {
  return writer.update(ref, buildUserArticleCanonicalIdClearPatch(), { lastUpdateTime });
}
