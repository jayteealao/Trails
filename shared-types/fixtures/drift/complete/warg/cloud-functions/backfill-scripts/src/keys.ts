// Fixture: the backfill marker producer, as the drift check reads it.
export const ARTICLE_MARKERS_COLLECTION = 'articleMarkers';

export function markerBody(key: string, itemId: string, source: string) {
  return {
    key,
    itemId,
    createdAt: serverTimestamp(),
    source,
  };
}
