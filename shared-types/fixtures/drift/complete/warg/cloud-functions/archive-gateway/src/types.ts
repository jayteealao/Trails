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

// Fixture: the archive key of each stored artifact kind.
export const KIND_TO_ARCHIVE_KEY = {
  'singlefile.html': 'singlefile',
  'monolith.html': 'monolith',
  'readability.md': 'readability',
  'ai-markdown.md': 'ai_markdown',
  'rendered.md': 'markdown',
  'page.pdf': 'pdf',
  'screenshot.png': 'screenshot',
  'rendered.html': 'rendered',
};
