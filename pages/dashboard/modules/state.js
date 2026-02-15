// @ts-check

export const CONFIG = {
  apiBase: '/api',
  pageSize: 50,
  defaultRefreshInterval: 30,
  feedPollInterval: 10000,
  feedMaxItems: 200,
};

export const STAGE_COLORS = {
  done: 'var(--stage-done)',
  failed: 'var(--stage-failed)',
  rendering: 'var(--stage-rendering)',
  deriving: 'var(--stage-deriving)',
  persisting: 'var(--stage-persisting)',
  queued: 'var(--stage-queued)',
};

export const PIPELINE_STEPS = [
  { id: 'render', label: 'Render', source: 'renderer' },
  { id: 'singlefile', label: 'Singlefile', source: 'singlefile' },
  { id: 'readability', label: 'Readability', source: 'readability' },
  { id: 'monolith', label: 'Monolith', source: 'monolith' },
  { id: 'persist', label: 'Persist', source: 'gcs' },
];

export const ARCHIVE_KEY_TO_STEP = {
  rendered: 'render',
  screenshot: 'render',
  pdf: 'render',
  singlefile: 'singlefile',
  readability: 'readability',
  markdown: 'readability',
  monolith: 'monolith',
};

export const VIEW_TITLES = {
  inbox: 'Inbox',
  overview: 'Overview',
  feed: 'Live Feed',
  requests: 'Requests',
  errors: 'Errors',
  articles: 'Articles',
  backfill: 'Backfill',
  infra: 'Infrastructure',
  detail: 'Request Detail',
  articleDetail: 'Article Detail',
};

/**
 * @typedef {{ currentView: string, previousView: string|null, requests: any[], selectedRequest: any, stats: any, infra: any, errors: any, inbox: any, filters: { domain: string, status: string, q: string, dateRange: string }, pagination: { offset: number, total: number|string, hasMore: boolean }, settings: { autoRefresh: boolean, refreshInterval: number }, presets: { selected: string, items: Record<string, { requests: { domain: string, status: string, q: string, dateRange: string }, articles: { status: string, search: string } }> }, loading: boolean, error: string|null, feed: { items: any[], knownIds: Set<string>, newCount: number, polling: boolean }, backfill: any, articles: { items: any[], selectedArticle: any, filters: { status: string, search: string }, pagination: { page: number, limit: number, total: number, hasMore: boolean } }, sort: { column: string, direction: string }, selectedRowIndex: number }} AppState
 */

/**
 * Global mutable application state.
 * All modules import and mutate the same object reference.
 * @type {AppState}
 */
export const state = {
  currentView: 'inbox',
  previousView: null,
  requests: [],
  selectedRequest: null,
  stats: null,
  infra: null,
  errors: null,
  inbox: null,
  filters: { domain: '', status: '', q: '', dateRange: '' },
  pagination: { offset: 0, total: 0, hasMore: false },
  settings: { autoRefresh: false, refreshInterval: CONFIG.defaultRefreshInterval },
  presets: { selected: '', items: {} },
  loading: false,
  error: null,
  feed: { items: [], knownIds: new Set(), newCount: 0, polling: false },
  backfill: null,
  articles: {
    items: [],
    selectedArticle: null,
    filters: { status: '', search: '' },
    pagination: { page: 1, limit: 50, total: 0, hasMore: false },
  },
  sort: { column: 'created', direction: 'desc' },
  selectedRowIndex: -1,
};

/** Timers — stored here so any module can start/stop them. */
export const timers = {
  refresh: null,
  feed: null,
  clock: null,
};
