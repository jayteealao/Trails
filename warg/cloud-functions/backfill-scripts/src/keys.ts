import { FieldValue } from 'firebase-admin/firestore';

/**
 * Marker subcollection name. Single source of truth shared with the Android
 * writer (`FirestoreBackupService.ARTICLE_MARKERS_COLLECTION`) and the rules.
 * Asserted cross-stack by `shared-types/check-drift.ts`.
 */
export const ARTICLE_MARKERS_COLLECTION = 'articleMarkers';

/** Provenance recorded on markers this package writes. */
export const MARKER_SOURCE = 'backfill';

/**
 * Marker doc keys for an article — a faithful port of the Android
 * `FirestoreBackupService.markerKeysFor`: the `itemId` always, plus the
 * `resolvedId` only when it is non-blank and distinct from `itemId`.
 *
 * The raw `resolvedId` value is used as the key (not a trimmed/canonicalized
 * form) so the marker doc ids are byte-identical to what the Android sync path
 * writes — parity here is load-bearing, since a divergent key would leave an
 * article unreadable after the read-rule flip.
 */
export function deriveMarkerKeys(
  itemId: string,
  resolvedId: string | null | undefined,
): string[] {
  const keys = [itemId];
  if (resolvedId != null && resolvedId.trim().length > 0 && resolvedId !== itemId) {
    keys.push(resolvedId);
  }
  return keys;
}

/**
 * Minimal marker body. The read rule only checks existence; the fields aid
 * backfill idempotency, coverage audit, and the drift check. Merge-written, so
 * re-running never clobbers an existing marker's original `source`/`createdAt`
 * when the caller skips already-present keys.
 */
export function markerBody(
  key: string,
  source: string = MARKER_SOURCE,
): Record<string, unknown> {
  return {
    key,
    createdAt: FieldValue.serverTimestamp(),
    source,
  };
}
