import type { DocumentData } from 'firebase-admin/firestore';
import type { PocketInput } from '@warg/article-writer';

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

export function buildPocket(
  userDoc: DocumentData,
  canonicalItemId: string
): PocketInput {
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
