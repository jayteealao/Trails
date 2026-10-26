import type { ReadabilityResult } from '@warg/shared';
import type { FinalizeRequest } from './types.js';

/**
 * Maps a readability.json result to the metadata map that /finalize writes
 * to Firestore. lead_image passes through unchanged; a result written before
 * the field existed maps to null.
 */
export function buildFinalizeMetadata(
  readability: ReadabilityResult
): NonNullable<FinalizeRequest['metadata']> {
  return {
    byline: readability.byline ?? '',
    excerpt: readability.excerpt ?? '',
    published_time: readability.publishedTime ?? null,
    site_name: readability.siteName ?? null,
    title: readability.title ?? '',
    word_count: readability.textContent?.split(/\s+/).filter(Boolean).length ?? 0,
    lead_image: typeof readability.leadImage === 'string' ? readability.leadImage : null,
  };
}
