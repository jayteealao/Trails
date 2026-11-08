// Fixture: the gcs worker metadata builder, as the drift check reads it.
export function buildFinalizeMetadata(readability) {
  return {
    byline: readability.byline ?? '',
    excerpt: readability.excerpt ?? '',
    published_time: readability.publishedTime ?? null,
    site_name: readability.siteName ?? null,
    title: readability.title ?? '',
    word_count: readability.wordCount ?? 0,
    lead_image: readability.leadImage ?? null,
  };
}
