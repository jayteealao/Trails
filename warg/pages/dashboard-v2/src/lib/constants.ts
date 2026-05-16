export const PAGE_SIZE = 50;
export const FEED_POLL_INTERVAL = 10000;
export const FEED_MAX_ITEMS = 200;

export const PIPELINE_STEPS = [
  { id: 'render', label: 'Render', source: 'renderer' },
  { id: 'singlefile', label: 'Singlefile', source: 'singlefile' },
  { id: 'readability', label: 'Readability', source: 'readability' },
  { id: 'monolith', label: 'Monolith', source: 'monolith' },
  { id: 'persist', label: 'Persist', source: 'gcs' },
] as const;

export const ARCHIVE_KEY_TO_STEP: Record<string, string> = {
  rendered: 'render',
  screenshot: 'render',
  pdf: 'render',
  singlefile: 'singlefile',
  readability: 'readability',
  markdown: 'readability',
  monolith: 'monolith',
};

export const STAGE_COLORS: Record<string, string> = {
  done: 'bg-stage-done',
  failed: 'bg-stage-failed',
  rendering: 'bg-stage-rendering',
  deriving: 'bg-stage-deriving',
  persisting: 'bg-stage-persisting',
  queued: 'bg-stage-queued',
};
