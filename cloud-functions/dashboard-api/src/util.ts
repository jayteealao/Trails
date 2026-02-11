export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

export function timestampToIso(ts: unknown): string {
  if (!ts) return '';
  // Firestore Timestamp object
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts) {
    return (ts as { toDate: () => Date }).toDate().toISOString();
  }
  // Already a string
  if (typeof ts === 'string') return ts;
  return '';
}
