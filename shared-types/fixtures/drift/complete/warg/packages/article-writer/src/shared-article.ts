// Fixture: the metadata the article writer stores, as the drift check reads it.
export interface ArticleMetadata {
  title: string;
  excerpt: string;
  byline: string;
  word_count: number;
  published_time: string | null;
  site_name: string | null;
  lead_image: string | null;
}
