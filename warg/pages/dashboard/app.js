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
import { debounce } from './modules/utils.js';
import { showView, registerFeedCallbacks, registerDetailLeaveCallback } from './modules/router.js';
import { clearError } from './modules/ui.js';
import { parseLocation, buildUrl, normalizeRouteState, isTopLevelView } from './modules/route-state.js';
import { loadInbox } from './modules/views/inbox.js';
import { loadStats } from './modules/views/overview.js';
import { renderFeed, startFeedPolling, stopFeedPolling } from './modules/views/feed.js';
import { loadRequests, updateSortHeaders, sortAndRenderRequests } from './modules/views/requests.js';
import {
  loadRequestDetail,
  stopDetailPoll,
  registerRequestDetailRouteSync,
} from './modules/views/detail.js';
import { loadErrors } from './modules/views/errors.js';
import { loadInfra } from './modules/views/infra.js';
import { loadBackfill } from './modules/views/backfill.js';
import {
  loadArticles,
  loadArticleDetail,
  registerArticleDetailRouteSync,
} from './modules/views/articles.js';

// ===== Wire callbacks into router =====
registerFeedCallbacks(startFeedPolling, stopFeedPolling);
registerDetailLeaveCallback(stopDetailPoll);

let applyingRoute = false;
let routeApplySeq = 0;
let hasInternalHistory = false;

function requestRouteSnapshot() {
  return {
    domain: state.filters.domain,
    status: state.filters.status,
    q: state.filters.q,
    dateRange: state.filters.dateRange,
    offset: state.pagination.offset,
    sort: state.sort.column,
    dir: state.sort.direction,
  };
}

function articleRouteSnapshot() {
  return {
    status: state.articles.filters.status,
    search: state.articles.filters.search,
    page: state.articles.pagination.page,
  };
}

function resolveOriginView(fallbackView) {
  if (isTopLevelView(state.currentView)) return state.currentView;
  if (isTopLevelView(state.previousView)) return state.previousView;

  const parsed = parseLocation(window.location);
  if (isTopLevelView(parsed.from)) return parsed.from;

  return fallbackView;
}

function currentRouteState() {
  const requests = requestRouteSnapshot();
  const articles = articleRouteSnapshot();

  if (state.currentView === 'detail') {
    const requestId = state.selectedRequest?.requestId || parseLocation(window.location).requestId;
    return {
      view: 'detail',
      requestId,
      from: resolveOriginView('requests'),
      requests,
      articles,
    };
  }

  if (state.currentView === 'articleDetail') {
    const itemId = state.articles.selectedArticle?.item_id || parseLocation(window.location).itemId;
    return {
      view: 'articleDetail',
      itemId,
      from: resolveOriginView('articles'),
      requests,
      articles,
    };
  }

  return {
    view: state.currentView,
    requests,
    articles,
  };
}

function commitRoute(routeState, { replace = false, markInternal = true } = {}) {
  const normalized = normalizeRouteState(routeState);
  const url = buildUrl(normalized);

  if (replace) {
    window.history.replaceState(normalized, '', url);
  } else {
    window.history.pushState(normalized, '', url);
  }

  if (markInternal) {
    hasInternalHistory = true;
  }

  return normalized;
}

function syncUrlForCurrentState({ replace = true } = {}) {
  if (applyingRoute) return;
  commitRoute(currentRouteState(), { replace, markInternal: true });
}

function hydrateRequestControls() {
  el.domainFilter.value = state.filters.domain;
  el.urlSearchFilter.value = state.filters.q;
  el.statusFilter.value = state.filters.status;
  el.dateRangeFilter.value = state.filters.dateRange;
}

function hydrateArticleControls() {
  el.articleStatusFilter.value = state.articles.filters.status;
  el.articleSearchFilter.value = state.articles.filters.search;
}

function applyRequestRouteState(route) {
  state.filters = {
    domain: route.requests.domain,
    status: route.requests.status,
    q: route.requests.q,
    dateRange: route.requests.dateRange,
  };
  state.pagination.offset = route.requests.offset;
  state.sort = {
    column: route.requests.sort,
    direction: route.requests.dir,
  };
  hydrateRequestControls();
  updateSortHeaders();
}

function applyArticleRouteState(route) {
  state.articles.filters = {
    status: route.articles.status,
    search: route.articles.search,
  };
  state.articles.pagination.page = route.articles.page;
  hydrateArticleControls();
}

function navigateTo(routeState, { replace = false } = {}) {
  const normalized = commitRoute(
    {
      ...routeState,
      requests: routeState.requests ?? requestRouteSnapshot(),
      articles: routeState.articles ?? articleRouteSnapshot(),
    },
    { replace, markInternal: true }
  );
  void applyRoute(normalized, { source: 'navigate' });
}

async function applyRoute(routeState, { source } = { source: 'navigate' }) {
  const normalized = normalizeRouteState(routeState);
  const applyId = ++routeApplySeq;

  applyingRoute = true;
  try {
    switch (normalized.view) {
      case 'inbox': {
        showView('inbox');
        await loadInbox();
        break;
      }
      case 'overview': {
        showView('overview');
        await loadStats();
        break;
      }
      case 'feed': {
        showView('feed');
        renderFeed();
        break;
      }
      case 'requests': {
        applyRequestRouteState(normalized);
        showView('requests');
        await loadRequests();
        if (applyId !== routeApplySeq) return;
        sortAndRenderRequests();
        break;
      }
      case 'errors': {
        showView('errors');
        await loadErrors();
        break;
      }
      case 'articles': {
        applyArticleRouteState(normalized);
        showView('articles');
        await loadArticles();
        break;
      }
      case 'backfill': {
        showView('backfill');
        await loadBackfill();
        break;
      }
      case 'infra': {
        showView('infra');
        await loadInfra();
        break;
      }
      case 'detail': {
        await loadRequestDetail(normalized.requestId, {
          syncUrl: false,
          forRouteApply: true,
          fromView: normalized.from || 'requests',
          replace: source === 'init',
        });
        if (isTopLevelView(normalized.from)) {
          state.previousView = normalized.from;
        }
        break;
      }
      case 'articleDetail': {
        await loadArticleDetail(normalized.itemId, {
          syncUrl: false,
          forRouteApply: true,
          fromView: normalized.from || 'articles',
          replace: source === 'init',
        });
        if (isTopLevelView(normalized.from)) {
          state.previousView = normalized.from;
        }
        break;
      }
      default: {
        showView('inbox');
        await loadInbox();
      }
    }
  } finally {
    applyingRoute = false;
  }
}

// Keep URL in sync when detail loaders are invoked directly from other modules.
registerRequestDetailRouteSync(({ requestId, replace = false, fromView }) => {
  const route = {
    view: 'detail',
    requestId,
    from: isTopLevelView(fromView) ? fromView : resolveOriginView('requests'),
    requests: requestRouteSnapshot(),
    articles: articleRouteSnapshot(),
  };
  commitRoute(route, { replace, markInternal: true });
});

registerArticleDetailRouteSync(({ itemId, replace = false, fromView }) => {
  const route = {
    view: 'articleDetail',
    itemId,
    from: isTopLevelView(fromView) ? fromView : resolveOriginView('articles'),
    requests: requestRouteSnapshot(),
    articles: articleRouteSnapshot(),
  };
  commitRoute(route, { replace, markInternal: true });
});

// ===== Refresh Logic =====
function refreshCurrentView() {
  if (state.currentView === 'inbox') loadInbox();
  else if (state.currentView === 'overview') loadStats();
  else if (state.currentView === 'requests') loadRequests().then(sortAndRenderRequests);
  else if (state.currentView === 'infra') loadInfra();
  else if (state.currentView === 'errors') loadErrors();
  else if (state.currentView === 'backfill') loadBackfill();
  else if (state.currentView === 'articles') loadArticles();
  else if (state.currentView === 'detail' && state.selectedRequest) {
    loadRequestDetail(state.selectedRequest.requestId, { syncUrl: false });
  } else if (state.currentView === 'articleDetail' && state.articles.selectedArticle) {
    loadArticleDetail(state.articles.selectedArticle.item_id, { syncUrl: false });
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
    } catch {
      // ignore malformed settings
    }
  }
  el.autoRefreshToggle.checked = state.settings.autoRefresh;
  el.refreshInterval.value = state.settings.refreshInterval;
  loadPresets();
  renderPresetOptions();
}

function saveSettings() {
  localStorage.setItem('warg-dashboard-settings', JSON.stringify(state.settings));
}

function loadPresets() {
  const saved = localStorage.getItem('warg-dashboard-presets-v1');
  if (!saved) return;
  try {
    const parsed = JSON.parse(saved);
    if (parsed && typeof parsed === 'object') {
      state.presets = {
        selected: '',
        items: parsed.items ?? {},
      };
    }
  } catch {
    // ignore malformed presets
  }
}

function savePresets() {
  localStorage.setItem('warg-dashboard-presets-v1', JSON.stringify({
    items: state.presets.items,
  }));
}

function renderPresetOptions() {
  const names = Object.keys(state.presets.items).sort();
  const options = ['<option value="">Saved views</option>'];
  for (const name of names) {
    options.push(`<option value="${name}">${name}</option>`);
  }
  if (el.requestPresetSelect) el.requestPresetSelect.innerHTML = options.join('');
  if (el.articlePresetSelect) el.articlePresetSelect.innerHTML = options.join('');
}

// ===== System Clock =====
function startSystemClock() {
  function update() {
    const now = new Date();
    el.systemClock.textContent = now.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });
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
    const id = result.requestId || result.request_id || result.itemId || 'unknown';
    const queued = result.queued === true && typeof result.itemId === 'string';
    el.archiveStatus.textContent = queued
      ? `Queued: ${id.slice(0, 8)}`
      : `OK: ${id.slice(0, 8)}`;
    el.archiveStatus.className = 'archive-status archive-ok';
    el.archiveInput.value = '';

    setTimeout(() => {
      if (queued) {
        loadArticleDetail(result.itemId, {
          fromView: resolveOriginView('articles'),
        });
      } else {
        loadRequestDetail(id, { fromView: resolveOriginView('requests') });
      }
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

function applyPreset(name, target) {
  const preset = state.presets.items[name];
  if (!preset) return;

  if (target === 'requests') {
    state.filters = { ...state.filters, ...preset.requests };
    state.pagination.offset = 0;
    hydrateRequestControls();
    syncUrlForCurrentState({ replace: false });
    loadRequests().then(sortAndRenderRequests);
  } else if (target === 'articles') {
    state.articles.filters = { ...state.articles.filters, ...preset.articles };
    state.articles.pagination.page = 1;
    hydrateArticleControls();
    syncUrlForCurrentState({ replace: false });
    loadArticles();
  }
}

function savePresetFromCurrent(target) {
  const name = window.prompt('Preset name');
  if (!name) return;

  state.presets.items[name] = {
    requests: {
      domain: state.filters.domain,
      status: state.filters.status,
      q: state.filters.q,
      dateRange: state.filters.dateRange,
    },
    articles: {
      status: state.articles.filters.status,
      search: state.articles.filters.search,
    },
  };
  savePresets();
  renderPresetOptions();

  if (target === 'requests' && el.requestPresetSelect) {
    el.requestPresetSelect.value = name;
  }
  if (target === 'articles' && el.articlePresetSelect) {
    el.articlePresetSelect.value = name;
  }
}

function getDetailFallbackView(defaultView) {
  const parsed = parseLocation(window.location);
  if (isTopLevelView(parsed.from)) {
    return parsed.from;
  }
  return defaultView;
}

function handleDetailBack(detailView) {
  const fallback = detailView === 'articleDetail'
    ? getDetailFallbackView('articles')
    : getDetailFallbackView('requests');

  if (detailView === 'articleDetail') {
    state.articles.selectedArticle = null;
  } else {
    state.selectedRequest = null;
  }

  if (hasInternalHistory && window.history.length > 1) {
    window.history.back();
    return;
  }

  navigateTo({ view: fallback });
}

// ===== Event Handlers =====
function setupEventHandlers() {
  // Navigation
  el.navItems.forEach((item) => {
    item.addEventListener('click', () => {
      const view = item.dataset.view;
      if (!view) return;
      navigateTo({ view });
    });
  });

  // Unified refresh button
  el.refreshCurrentBtn.addEventListener('click', refreshCurrentView);

  // Article filters
  el.articleStatusFilter.addEventListener('change', (e) => {
    state.articles.filters.status = e.target.value;
    state.articles.pagination.page = 1;
    syncUrlForCurrentState({ replace: true });
    loadArticles();
  });

  el.articleSearchFilter.addEventListener('input', debounce((e) => {
    state.articles.filters.search = e.target.value.trim();
    state.articles.pagination.page = 1;
    syncUrlForCurrentState({ replace: true });
    loadArticles();
  }, 300));

  if (el.articlePresetSelect) {
    el.articlePresetSelect.addEventListener('change', (e) => {
      const name = e.target.value;
      if (!name) return;
      applyPreset(name, 'articles');
    });
  }
  if (el.saveArticlePresetBtn) {
    el.saveArticlePresetBtn.addEventListener('click', () => savePresetFromCurrent('articles'));
  }

  // Article pagination
  el.articlePrevPage.addEventListener('click', () => {
    if (state.articles.pagination.page > 1) {
      state.articles.pagination.page--;
      syncUrlForCurrentState({ replace: false });
      loadArticles();
    }
  });

  el.articleNextPage.addEventListener('click', () => {
    if (state.articles.pagination.hasMore) {
      state.articles.pagination.page++;
      syncUrlForCurrentState({ replace: false });
      loadArticles();
    }
  });

  // Article back button
  el.articleBackBtn.addEventListener('click', () => {
    handleDetailBack('articleDetail');
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
    syncUrlForCurrentState({ replace: true });
    loadRequests().then(sortAndRenderRequests);
  }, 300));

  // URL search filter
  el.urlSearchFilter.addEventListener('input', debounce((e) => {
    state.filters.q = e.target.value.trim();
    state.pagination.offset = 0;
    syncUrlForCurrentState({ replace: true });
    loadRequests().then(sortAndRenderRequests);
  }, 300));

  // Status filter
  el.statusFilter.addEventListener('change', (e) => {
    state.filters.status = e.target.value;
    state.pagination.offset = 0;
    syncUrlForCurrentState({ replace: true });
    loadRequests().then(sortAndRenderRequests);
  });

  // Date range filter
  el.dateRangeFilter.addEventListener('change', (e) => {
    state.filters.dateRange = e.target.value;
    state.pagination.offset = 0;
    syncUrlForCurrentState({ replace: true });
    loadRequests().then(sortAndRenderRequests);
  });

  if (el.requestPresetSelect) {
    el.requestPresetSelect.addEventListener('change', (e) => {
      const name = e.target.value;
      if (!name) return;
      applyPreset(name, 'requests');
    });
  }
  if (el.saveRequestPresetBtn) {
    el.saveRequestPresetBtn.addEventListener('click', () => savePresetFromCurrent('requests'));
  }

  // Pagination
  el.prevPage.addEventListener('click', () => {
    if (state.pagination.offset > 0) {
      state.pagination.offset = Math.max(0, state.pagination.offset - CONFIG.pageSize);
      syncUrlForCurrentState({ replace: false });
      loadRequests().then(sortAndRenderRequests);
    }
  });

  el.nextPage.addEventListener('click', () => {
    if (state.pagination.hasMore) {
      state.pagination.offset += CONFIG.pageSize;
      syncUrlForCurrentState({ replace: false });
      loadRequests().then(sortAndRenderRequests);
    }
  });

  // Back button
  el.backBtn.addEventListener('click', () => {
    handleDetailBack('detail');
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
    state.settings.refreshInterval = Number.parseInt(el.refreshInterval.value, 10) || CONFIG.defaultRefreshInterval;
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
  el.requestTable.querySelectorAll('th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (!col) return;
      if (state.sort.column === col) {
        state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort.column = col;
        state.sort.direction = 'asc';
      }
      updateSortHeaders();
      sortAndRenderRequests();
      syncUrlForCurrentState({ replace: true });
    });
  });

  // Keyboard shortcuts
  const viewKeys = {
    '1': 'inbox',
    '2': 'overview',
    '3': 'feed',
    '4': 'requests',
    '5': 'errors',
    '6': 'articles',
    '7': 'backfill',
    '8': 'infra',
  };

  document.addEventListener('keydown', (e) => {
    const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT';

    // Escape — always active
    if (e.key === 'Escape') {
      if (!el.settingsModal.classList.contains('hidden')) {
        el.settingsModal.classList.add('hidden');
      } else if (state.currentView === 'articleDetail') {
        handleDetailBack('articleDetail');
      } else if (state.currentView === 'detail') {
        handleDetailBack('detail');
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

    // 1-8 — switch views
    if (viewKeys[e.key]) {
      navigateTo({ view: viewKeys[e.key] });
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
      rows.forEach((r) => r.classList.remove('selected'));

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
    }
  });
}

// ===== Initialize =====
loadSettings();
setupEventHandlers();
startSystemClock();

window.addEventListener('popstate', (event) => {
  const route = event.state ? normalizeRouteState(event.state) : parseLocation(window.location);
  hasInternalHistory = true;
  void applyRoute(route, { source: 'popstate' });
});

const initialRoute = normalizeRouteState(parseLocation(window.location));
commitRoute(initialRoute, { replace: true, markInternal: false });
void applyRoute(initialRoute, { source: 'init' });

if (state.settings.autoRefresh) {
  startAutoRefresh();
}
