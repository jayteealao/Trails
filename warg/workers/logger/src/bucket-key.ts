export const BUCKET_KEY_PREFIX = 'bucket:';

/**
 * Hour-bucket DO key for a timestamp: `bucket:YYYYMMDDHH` (UTC).
 * All requests initialized within the same UTC hour share one DO instance.
 */
export function bucketKeyForTs(isoTs: string): string {
  const d = new Date(isoTs);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  return `${BUCKET_KEY_PREFIX}${y}${mo}${da}${h}`;
}
