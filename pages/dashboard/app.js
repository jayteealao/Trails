// Warg Observatory Dashboard — ES Module Entrypoint
//
// API Routing:
// All requests go to /api/* via CONFIG.apiBase.
//
// Pages Functions (proxy to dashboard-api Cloud Function):
//   GET /api/articles          -> list articles
//   GET /api/articles/:itemId  -> article detail
//   GET /api/signed-url        -> GCS signed URL for archive viewing
//
// Gateway Worker (via Pages Functions):
//   GET  /api/stats            -> pipeline statistics
//   GET  /api/requests         -> request list/search
//   GET  /api/:requestId       -> request detail
//   POST /api/begin            -> start archive
//   GET  /api/infra            -> infrastructure status
//   GET  /api/backfill         -> backfill status

import { el } from './modules/el.js';
import { state, CONFIG, timers } from './modules/state.js';
import { submitArchive } from './modules/api.js';
import { debounce, dateRangeToParams } from './modules/utils.js';
import { showView, registerFeedCallbacks, registerDetailLeaveCallback } from './modules/router.js';
import { clearError } from './modules/ui.js';
import { loadStats } from './modules/views/overview.js';
import { renderFeed, startFeedPolling, stopFeedPolling } from './modules/views/feed.js';
import { loadRequests, updateSortHeaders, sortAndRenderRequests } from './modules/views/requests.js';
import { loadRequestDetail, stopDetailPoll } from './modules/views/detail.js';
import { loadErrors } from './modules/views/errors.js';
import { loadInfra } from './modules/views/infra.js';
import { loadBackfill } from './modules/views/backfill.js';
import { loadArticles } from './modules/views/articles.js';

// ===== Wire callbacks into router =====
registerFeedCallbacks(startFeedPolling, stopFeedPolling);
registerDetailLeaveCallback(stopDetailPoll);

// ===== Refresh Logic =====
function refreshCurrentView() {
  if (state.currentView === 'overview') loadStats();
  else if (state.currentView === 'requests') loadRequests();
  else if (state.currentView === 'infra') loadInfra();
  else if (state.currentView === 'errors') loadErrors();
  else if (state.currentView === 'backfill') loadBackfill();
  else if (state.currentView === 'articles') loadArticles();
  else if (state.currentView === 'detail' && state.selectedRequest) {
    loadRequestDetail(state.selectedRequest.requestId);
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  if (state.settings.autoRefresh) {
    timers.refresh = setInterval(refreshCurrentView, state.settings.refreshInterval * 1000);
  }
}

function stopAutoRefresh() {
  if (timers.refresh) {
    clearInterval(timers.refresh);
    timers.refresh = null;
  }
}

// ===== Settings =====
function loadSettings() {
  const saved = localStorage.getItem('warg-dashboard-settings');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      state.settings = { ...state.settings, ...parsed };
    } catch { /* ignore */ }
  }
  el.autoRefreshToggle.checked = state.settings.autoRefresh;
  el.refreshInterval.value = state.settings.refreshInterval;
}

function saveSettings() {
  localStorage.setItem('warg-dashboard-settings', JSON.stringify(state.settings));
}

// ===== System Clock =====
function startSystemClock() {
  function update() {
    const now = new Date();
    el.systemClock.textContent = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  }
  update();
  timers.clock = setInterval(update, 1000);
}

// ===== Archive Submission (Top Bar) =====
async function handleArchiveSubmit() {
  const url = el.archiveInput.value.trim();
  if (!url) return;

  try {
    new URL(url);
  } catch {
    el.archiveStatus.textContent = 'Invalid URL';
    el.archiveStatus.className = 'archive-status archive-err';
    return;
  }

  el.archiveBtn.disabled = true;
  el.archiveStatus.textContent = 'Submitting...';
  el.archiveStatus.className = 'archive-status';

  try {
    const result = await submitArchive(url);
    const id = result.requestId || result.request_id || 'unknown';
    el.archiveStatus.textContent = `OK: ${id.slice(0, 8)}`;
    el.archiveStatus.className = 'archive-status archive-ok';
    el.archiveInput.value = '';

    setTimeout(() => {
      loadRequestDetail(id);
      el.archiveStatus.textContent = '';
      el.archiveStatus.className = 'archive-status';
    }, 800);
  } catch (err) {
    el.archiveStatus.textContent = err.message;
    el.archiveStatus.className = 'archive-status archive-err';
  } finally {
    el.archiveBtn.disabled = false;
  }
}

// ===== Event Handlers =====
function setupEventHandlers() {
  // Navigation
  el.navItems.forEach(item => {
    item.addEventListener('click', () => {
      const view = item.dataset.view;
      showView(view);
      if (view === 'overview' && !state.stats) loadStats();
      else if (view === 'requests' && state.requests.length === 0) loadRequests();
      else if (view === 'infra' && !state.infra) loadInfra();
      else if (view === 'feed') renderFeed();
      else if (view === 'errors' && !state.errors) loadErrors();
      else if (view === 'backfill' && !state.backfill) loadBackfill();
      else if (view === 'articles' && state.articles.items.length === 0) loadArticles();
    });
  });

  // Unified refresh button
  el.refreshCurrentBtn.addEventListener('click', refreshCurrentView);

  // Article filters
  el.articleStatusFilter.addEventListener('change', (e) => {
    state.articles.filters.status = e.target.value;
    state.articles.pagination.page = 1;
    loadArticles();
  });

  el.articleSearchFilter.addEventListener('input', debounce((e) => {
    state.articles.filters.search = e.target.value.trim();
    state.articles.pagination.page = 1;
    loadArticles();
  }, 300));

  // Article pagination
  el.articlePrevPage.addEventListener('click', () => {
    if (state.articles.pagination.page > 1) {
      state.articles.pagination.page--;
      loadArticles();
    }
  });

  el.articleNextPage.addEventListener('click', () => {
    if (state.articles.pagination.hasMore) {
      state.articles.pagination.page++;
      loadArticles();
    }
  });

  // Article back button
  el.articleBackBtn.addEventListener('click', () => {
    showView('articles');
    state.articles.selectedArticle = null;
  });

  // Auto-refresh toggle
  el.autoRefreshToggle.addEventListener('change', (e) => {
    state.settings.autoRefresh = e.target.checked;
    saveSettings();
    if (e.target.checked) startAutoRefresh();
    else stopAutoRefresh();
  });

  // Domain filter
  el.domainFilter.addEventListener('input', debounce((e) => {
    state.filters.domain = e.target.value.trim();
    state.pagination.offset = 0;
    loadRequests();
  }, 300));

  // URL search filter
  el.urlSearchFilter.addEventListener('input', debounce((e) => {
    state.filters.q = e.target.value.trim();
    state.pagination.offset = 0;
    loadRequests();
  }, 300));

  // Status filter
  el.statusFilter.addEventListener('change', (e) => {
    state.filters.status = e.target.value;
    state.pagination.offset = 0;
    loadRequests();
  });

  // Date range filter
  el.dateRangeFilter.addEventListener('change', (e) => {
    state.filters.dateRange = e.target.value;
    state.pagination.offset = 0;
    loadRequests();
  });

  // Pagination
  el.prevPage.addEventListener('click', () => {
    if (state.pagination.offset > 0) {
      state.pagination.offset = Math.max(0, state.pagination.offset - CONFIG.pageSize);
      loadRequests();
    }
  });

  el.nextPage.addEventListener('click', () => {
    if (state.pagination.hasMore) {
      state.pagination.offset += CONFIG.pageSize;
      loadRequests();
    }
  });

  // Back button
  el.backBtn.addEventListener('click', () => {
    const backTo = state.previousView === 'feed' ? 'feed' : 'requests';
    showView(backTo);
    state.selectedRequest = null;
  });

  // Error close
  el.errorClose.addEventListener('click', clearError);

  // Settings modal
  el.settingsBtn.addEventListener('click', () => {
    el.refreshInterval.value = state.settings.refreshInterval;
    el.settingsModal.classList.remove('hidden');
  });

  el.settingsClose.addEventListener('click', () => el.settingsModal.classList.add('hidden'));
  el.settingsCancel.addEventListener('click', () => el.settingsModal.classList.add('hidden'));

  el.settingsSave.addEventListener('click', () => {
    state.settings.refreshInterval = parseInt(el.refreshInterval.value, 10) || CONFIG.defaultRefreshInterval;
    saveSettings();
    if (state.settings.autoRefresh) startAutoRefresh();
    el.settingsModal.classList.add('hidden');
  });

  el.settingsModal.addEventListener('click', (e) => {
    if (e.target === el.settingsModal) el.settingsModal.classList.add('hidden');
  });

  // Archive form
  el.archiveBtn.addEventListener('click', handleArchiveSubmit);
  el.archiveInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleArchiveSubmit();
  });

  // Sort headers
  el.requestTable.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (state.sort.column === col) {
        state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort.column = col;
        state.sort.direction = 'asc';
      }
      updateSortHeaders();
      sortAndRenderRequests();
    });
  });

  // Keyboard shortcuts
  const viewKeys = { '1': 'overview', '2': 'feed', '3': 'requests', '4': 'errors', '5': 'articles', '6': 'backfill', '7': 'infra' };

  document.addEventListener('keydown', (e) => {
    const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT';

    // Escape — always active
    if (e.key === 'Escape') {
      if (!el.settingsModal.classList.contains('hidden')) {
        el.settingsModal.classList.add('hidden');
      } else if (state.currentView === 'articleDetail') {
        showView('articles');
        state.articles.selectedArticle = null;
      } else if (state.currentView === 'detail') {
        const backTo = state.previousView === 'feed' ? 'feed' : 'requests';
        showView(backTo);
        state.selectedRequest = null;
      } else if (isInput) {
        e.target.blur();
      }
      return;
    }

    // Everything below ignores input fields
    if (isInput || e.ctrlKey || e.metaKey) return;

    // r — refresh
    if (e.key === 'r') {
      refreshCurrentView();
      return;
    }

    // / — focus search input
    if (e.key === '/') {
      e.preventDefault();
      if (state.currentView === 'requests') el.domainFilter.focus();
      else if (state.currentView === 'articles') el.articleSearchFilter.focus();
      return;
    }

    // a — focus archive input
    if (e.key === 'a') {
      e.preventDefault();
      el.archiveInput.focus();
      return;
    }

    // 1-7 — switch views
    if (viewKeys[e.key]) {
      const view = viewKeys[e.key];
      showView(view);
      // Trigger load for views that need it
      if (view === 'overview' && !state.stats) loadStats();
      else if (view === 'requests' && state.requests.length === 0) loadRequests();
      else if (view === 'infra' && !state.infra) loadInfra();
      else if (view === 'errors' && !state.errors) loadErrors();
      else if (view === 'backfill' && !state.backfill) loadBackfill();
      else if (view === 'articles' && state.articles.items.length === 0) loadArticles();
      return;
    }

    // j/k — row navigation in table views
    if (e.key === 'j' || e.key === 'k') {
      const tableBody = state.currentView === 'requests' ? el.requestTableBody
        : state.currentView === 'articles' ? document.getElementById('articleTableBody')
        : null;
      if (!tableBody) return;

      const rows = tableBody.querySelectorAll('tr.clickable');
      if (rows.length === 0) return;

      // Remove previous selection
      rows.forEach(r => r.classList.remove('selected'));

      if (e.key === 'j') {
        state.selectedRowIndex = Math.min(state.selectedRowIndex + 1, rows.length - 1);
      } else {
        state.selectedRowIndex = Math.max(state.selectedRowIndex - 1, 0);
      }

      const row = rows[state.selectedRowIndex];
      row.classList.add('selected');
      row.scrollIntoView({ block: 'nearest' });
      return;
    }

    // Enter — open selected row
    if (e.key === 'Enter' && state.selectedRowIndex >= 0) {
      const tableBody = state.currentView === 'requests' ? el.requestTableBody
        : state.currentView === 'articles' ? document.getElementById('articleTableBody')
        : null;
      if (!tableBody) return;

      const rows = tableBody.querySelectorAll('tr.clickable');
      if (rows[state.selectedRowIndex]) {
        rows[state.selectedRowIndex].click();
      }
      return;
    }
  });
}

// ===== Initialize =====
loadSettings();
setupEventHandlers();
startSystemClock();
showView('overview');
loadStats();

if (state.settings.autoRefresh) {
  startAutoRefresh();
}
