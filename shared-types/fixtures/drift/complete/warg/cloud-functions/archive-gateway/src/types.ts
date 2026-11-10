// Fixture: the archive gateway finalize request, as the drift check reads it.
export interface FinalizeRequest {
  item_id: string;
  metadata?: {
    title: string;
    excerpt: string;
    byline: string;
    word_count: number;
    published_time: string | null;
    site_name: string | null;
    lead_image: string | null;
  };
}
