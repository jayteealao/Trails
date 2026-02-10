/**
 * Archive classification for dashboard display.
 */
export type ArchiveClassification =
  | 'unarchived'
  | 'incomplete'
  | 'complete'
  | 'failed'
  | 'processing';

/**
 * The 4 core archives required for "complete" classification.
 */
export const CORE_ARCHIVES = ['rendered', 'readability', 'markdown', 'singlefile'] as const;

/**
 * All archive keys that can exist on a canonical article.
 */
export const ALL_ARCHIVE_KEYS = [
  'rendered',
  'singlefile',
  'readability',
  'markdown',
  'monolith',
  'pdf',
  'screenshot',
] as const;

/**
 * Per-archive status for a single archive key.
 */
export interface ArchiveStatus {
  key: string;
  status: 'success' | 'pending' | 'failed' | 'absent';
  gcs_path?: string;
  compressed_size?: number;
  created_at?: string;
}

/**
 * Article list item returned by GET /articles.
 */
export interface ArticleListItem {
  item_id: string;
  url: string;
  title?: string;
  domain: string;
  created_at: string;
  archive_classification: ArchiveClassification;
  archives: ArchiveStatus[];
  warg_request_id?: string;
  has_canonical: boolean;
}

/**
 * Full article detail returned by GET /articles/:itemId.
 */
export interface ArticleDetail extends ArticleListItem {
  metadata?: {
    byline?: string;
    excerpt?: string;
    published_time?: string | null;
    site_name?: string | null;
    title?: string;
    word_count?: number;
  };
  pocket?: {
    favorite?: string;
    resolved_id?: string;
    status?: string;
    time_added?: number;
    time_read?: number;
  };
  images?: Array<{ src: string; height?: number; width?: number }>;
  firestore_status?: string;
  error?: string;
  processing_started_at?: string;
}

/**
 * Paginated response for article listing.
 */
export interface ArticleListResponse {
  articles: ArticleListItem[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}
