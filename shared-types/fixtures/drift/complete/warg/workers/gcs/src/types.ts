// Fixture: the gcs worker finalize request, as the drift check reads it.
export interface FinalizeRequest {
  item_id: string;
  metadata?: {
    byline: string;
    excerpt: string;
    published_time: string | null;
    site_name: string | null;
    title: string;
    word_count: number;
    lead_image: string | null;
  };
}
