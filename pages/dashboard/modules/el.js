// @ts-check

/**
 * Cached DOM element references.
 * Resolved once at import time (script type="module" runs after DOM is parsed via defer).
 */
export const el = {
  overviewView: document.getElementById('overviewView'),
  requestsView: document.getElementById('requestsView'),
  detailView: document.getElementById('detailView'),
  infraView: document.getElementById('infraView'),
  feedView: document.getElementById('feedView'),
  errorsView: document.getElementById('errorsView'),
  backfillView: document.getElementById('backfillView'),
  articlesView: document.getElementById('articlesView'),
  articleDetailView: document.getElementById('articleDetailView'),
  navItems: document.querySelectorAll('.nav-item[data-view]'),
  feedBadge: document.getElementById('feedBadge'),
  pageTitle: document.getElementById('pageTitle'),
  // Connection
  connDot: document.getElementById('connDot'),
  connLabel: document.getElementById('connLabel'),
  systemClock: document.getElementById('systemClock'),
  // Archive form
  archiveInput: document.getElementById('archiveInput'),
  archiveBtn: document.getElementById('archiveBtn'),
  archiveStatus: document.getElementById('archiveStatus'),
  // Top bar
  refreshCurrentBtn: document.getElementById('refreshCurrentBtn'),
  autoRefreshToggle: document.getElementById('autoRefreshToggle'),
  // Overview
  statTotal: document.getElementById('statTotal'),
  statSuccessRate: document.getElementById('statSuccessRate'),
  statActive: document.getElementById('statActive'),
  statStuck: document.getElementById('statStuck'),
  statLast1h: document.getElementById('statLast1h'),
  statLast24h: document.getElementById('statLast24h'),
  segmentedBar: document.getElementById('segmentedBar'),
  segmentedLegend: document.getElementById('segmentedLegend'),
  topDomains: document.getElementById('topDomains'),
  recentFailures: document.getElementById('recentFailures'),
  // Infra
  workersPanel: document.getElementById('workersPanel'),
  workflowsPanel: document.getElementById('workflowsPanel'),
  storagePanel: document.getElementById('storagePanel'),
  // Requests
  requestTableBody: document.getElementById('requestTableBody'),
  requestTable: document.getElementById('requestTable'),
  domainFilter: document.getElementById('domainFilter'),
  urlSearchFilter: document.getElementById('urlSearchFilter'),
  statusFilter: document.getElementById('statusFilter'),
  dateRangeFilter: document.getElementById('dateRangeFilter'),
  prevPage: document.getElementById('prevPage'),
  nextPage: document.getElementById('nextPage'),
  paginationInfo: document.getElementById('paginationInfo'),
  backBtn: document.getElementById('backBtn'),
  detailContent: document.getElementById('detailContent'),
  // Feed
  feedContainer: document.getElementById('feedContainer'),
  feedCount: document.getElementById('feedCount'),
  feedLed: document.getElementById('feedLed'),
  // Errors
  errorsContent: document.getElementById('errorsContent'),
  // Backfill
  backfillContent: document.getElementById('backfillContent'),
  // Articles
  articleTableBody: document.getElementById('articleTableBody'),
  articleStatusFilter: document.getElementById('articleStatusFilter'),
  articleSearchFilter: document.getElementById('articleSearchFilter'),
  articlePrevPage: document.getElementById('articlePrevPage'),
  articleNextPage: document.getElementById('articleNextPage'),
  articlePaginationInfo: document.getElementById('articlePaginationInfo'),
  articleBackBtn: document.getElementById('articleBackBtn'),
  articleDetailContent: document.getElementById('articleDetailContent'),
  // UI
  loadingOverlay: document.getElementById('loadingOverlay'),
  errorBanner: document.getElementById('errorBanner'),
  errorMessage: document.getElementById('errorMessage'),
  errorClose: document.getElementById('errorClose'),
  toastBanner: document.getElementById('toastBanner'),
  toastMessage: document.getElementById('toastMessage'),
  // Settings
  settingsBtn: document.getElementById('settingsBtn'),
  settingsModal: document.getElementById('settingsModal'),
  settingsClose: document.getElementById('settingsClose'),
  settingsCancel: document.getElementById('settingsCancel'),
  settingsSave: document.getElementById('settingsSave'),
  refreshInterval: document.getElementById('refreshInterval'),
};
