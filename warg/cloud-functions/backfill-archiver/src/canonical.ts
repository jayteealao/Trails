import type { DocumentData } from 'firebase-admin/firestore';

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

export function resolveCanonicalFromUserDoc(
  itemId: string,
  userDoc: DocumentData | undefined
): string {
  if (!userDoc) return itemId;
  const resolvedId = userDoc['resolvedId'];
  if (typeof resolvedId !== 'string') return itemId;
  const trimmed = resolvedId.trim();
  return trimmed.length > 0 ? trimmed : itemId;
}

export function buildPocket(
  userDoc: DocumentData,
  canonicalItemId: string
): Record<string, unknown> {
  return {
    favorite: userDoc['favorite'] ?? '',
    resolved_id:
      typeof userDoc['resolvedId'] === 'string' &&
      userDoc['resolvedId'].trim().length > 0
        ? userDoc['resolvedId']
        : canonicalItemId,
    status: userDoc['status'] ?? '',
    time_added: userDoc['timeAdded'] ?? 0,
    time_read: userDoc['timeRead'] ?? 0,
  };
}
