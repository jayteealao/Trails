// Warg Observatory - Dashboard Application

(function () {
  'use strict';

  // ===== Configuration =====
  const CONFIG = {
    apiBase: '/api',
    pageSize: 50,
    defaultRefreshInterval: 30,
  };

  // ===== State =====
  const state = {
    currentView: 'requests',
    requests: [],
    selectedRequest: null,
    filters: {
      domain: '',
      status: '',
    },
    pagination: {
      offset: 0,
      total: 0,
      hasMore: false,
    },
    settings: {
      autoRefresh: false,
      refreshInterval: CONFIG.defaultRefreshInterval,
    },
    loading: false,
    error: null,
  };

  let refreshTimer = null;

  // ===== DOM Elements =====
  const elements = {
    // Views
    requestsView: document.getElementById('requestsView'),
    detailView: document.getElementById('detailView'),
    // Request list
    requestList: document.getElementById('requestList'),
    domainFilter: document.getElementById('domainFilter'),
    statusFilter: document.getElementById('statusFilter'),
    // Pagination
    pagination: document.getElementById('pagination'),
    prevPage: document.getElementById('prevPage'),
    nextPage: document.getElementById('nextPage'),
    paginationInfo: document.getElementById('paginationInfo'),
    // Actions
    refreshBtn: document.getElementById('refreshBtn'),
    autoRefreshToggle: document.getElementById('autoRefreshToggle'),
    backBtn: document.getElementById('backBtn'),
    // Detail
    detailContent: document.getElementById('detailContent'),
    // Loading & Error
    loadingOverlay: document.getElementById('loadingOverlay'),
    errorBanner: document.getElementById('errorBanner'),
    errorMessage: document.getElementById('errorMessage'),
    errorClose: document.getElementById('errorClose'),
    // Settings modal
    settingsBtn: document.getElementById('settingsBtn'),
    settingsModal: document.getElementById('settingsModal'),
    settingsClose: document.getElementById('settingsClose'),
    settingsCancel: document.getElementById('settingsCancel'),
    settingsSave: document.getElementById('settingsSave'),
    refreshInterval: document.getElementById('refreshInterval'),
  };

  // ===== API Client =====
  async function apiRequest(endpoint) {
    const response = await fetch(`${CONFIG.apiBase}${endpoint}`);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `HTTP ${response.status}`);
    }
    return response.json();
  }

  async function fetchRequests() {
    const params = new URLSearchParams();
    if (state.filters.domain) {
      params.set('domain', state.filters.domain);
    }
    if (state.filters.status) {
      params.set('status', state.filters.status);
    }
    params.set('limit', CONFIG.pageSize);
    params.set('offset', state.pagination.offset);

    const data = await apiRequest(`/requests?${params}`);
    return data;
  }

  async function fetchRequestDetail(requestId) {
    const data = await apiRequest(`/${requestId}`);
    return data;
  }

  // ===== Render Functions =====
  function renderRequestList() {
    if (state.requests.length === 0) {
      elements.requestList.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <div class="empty-state-title">No requests found</div>
          <div class="empty-state-text">Try adjusting your filters or check back later</div>
        </div>
      `;
      return;
    }

    elements.requestList.innerHTML = state.requests.map(req => {
      const errorCount = req.errorCount || 0;
      const stage = req.stage || 'queued';
      const createdAt = formatTime(req.createdAt);

      return `
        <div class="request-card" data-id="${escapeHtml(req.requestId)}">
          <div class="request-info">
            <div class="request-url">${escapeHtml(req.url || 'Unknown URL')}</div>
            <div class="request-meta">
              <span class="request-domain">${escapeHtml(req.domain || 'unknown')}</span>
              <span class="request-time">${createdAt}</span>
            </div>
          </div>
          <span class="status-badge status-${stage}">${stage}</span>
          ${errorCount > 0 ? `
            <span class="error-count">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              ${errorCount}
            </span>
          ` : ''}
          <svg class="request-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;color:var(--text-muted)">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
      `;
    }).join('');

    // Attach click handlers
    elements.requestList.querySelectorAll('.request-card').forEach(card => {
      card.addEventListener('click', () => {
        const requestId = card.dataset.id;
        loadRequestDetail(requestId);
      });
    });
  }

  function renderPagination() {
    const start = state.pagination.offset + 1;
    const end = state.pagination.offset + state.requests.length;
    const total = state.pagination.total || '?';

    elements.paginationInfo.textContent = state.requests.length > 0
      ? `Showing ${start}-${end} of ${total}`
      : 'No results';

    elements.prevPage.disabled = state.pagination.offset === 0;
    elements.nextPage.disabled = !state.pagination.hasMore;
  }

  function renderDetailView() {
    const req = state.selectedRequest;
    if (!req) {
      elements.detailContent.innerHTML = '<div class="empty-state">Request not found</div>';
      return;
    }

    const stage = req.derived?.stage || 'queued';
    const events = req.events || [];
    const artifacts = req.artifacts || [];
    const domain = req.url ? new URL(req.url).hostname : 'unknown';

    elements.detailContent.innerHTML = `
      <!-- Header -->
      <div class="detail-header">
        <div class="detail-url">${escapeHtml(req.url || 'Unknown URL')}</div>
        <div class="detail-meta">
          <div class="detail-meta-item">
            <span class="detail-meta-label">Request ID</span>
            <span class="detail-meta-value copyable" data-copy="${escapeHtml(req.requestId)}" title="Click to copy">
              ${escapeHtml(req.requestId)}
            </span>
          </div>
          <div class="detail-meta-item">
            <span class="detail-meta-label">Domain</span>
            <span class="detail-meta-value">${escapeHtml(domain)}</span>
          </div>
          <div class="detail-meta-item">
            <span class="detail-meta-label">Status</span>
            <span class="status-badge status-${stage}">${stage}</span>
          </div>
          <div class="detail-meta-item">
            <span class="detail-meta-label">Created</span>
            <span class="detail-meta-value">${formatTime(req.createdAt)}</span>
          </div>
        </div>
      </div>

      <!-- Events Timeline -->
      <div class="section">
        <div class="section-header">
          <span class="section-title">Events Timeline</span>
          <span class="section-count">${events.length} events</span>
        </div>
        <div class="section-body">
          ${renderTimeline(events)}
        </div>
      </div>

      <!-- Artifacts -->
      <div class="section">
        <div class="section-header">
          <span class="section-title">Artifacts</span>
          <span class="section-count">${artifacts.length} artifacts</span>
        </div>
        <div class="section-body">
          ${renderArtifacts(artifacts)}
        </div>
      </div>
    `;

    // Attach copy handlers
    elements.detailContent.querySelectorAll('.copyable').forEach(el => {
      el.addEventListener('click', () => {
        const text = el.dataset.copy;
        navigator.clipboard.writeText(text).then(() => {
          showToast('Copied to clipboard');
        });
      });
    });
  }

  function renderTimeline(events) {
    if (events.length === 0) {
      return `
        <div class="empty-state">
          <div class="empty-state-text">No events recorded</div>
        </div>
      `;
    }

    // Sort events by timestamp (oldest first for timeline)
    const sortedEvents = [...events].sort((a, b) =>
      new Date(a.ts) - new Date(b.ts)
    );

    return `
      <div class="timeline">
        ${sortedEvents.map(event => {
      const level = event.level || 'info';
      const data = event.data ? JSON.stringify(event.data, null, 2) : null;

      return `
            <div class="timeline-item" data-level="${level}">
              <div class="timeline-node"></div>
              <div class="timeline-time">${formatTime(event.ts)}</div>
              <div class="timeline-content">
                <div class="timeline-header">
                  <span class="timeline-source">${escapeHtml(event.source || 'system')}</span>
                  <span class="timeline-type">${escapeHtml(event.type || 'unknown')}</span>
                </div>
                <div class="timeline-message">${escapeHtml(event.message || '')}</div>
                ${data ? `<pre class="timeline-data">${escapeHtml(data)}</pre>` : ''}
              </div>
            </div>
          `;
    }).join('')}
      </div>
    `;
  }

  function renderArtifacts(artifacts) {
    if (artifacts.length === 0) {
      return `
        <div class="empty-state">
          <div class="empty-state-text">No artifacts generated</div>
        </div>
      `;
    }

    return `
      <div class="artifacts-grid">
        ${artifacts.map(artifact => `
          <div class="artifact-card">
            <div class="artifact-kind">${escapeHtml(artifact.kind || 'unknown')}</div>
            <div class="artifact-meta">
              ${artifact.bytes ? `<span>${formatBytes(artifact.bytes)}</span>` : ''}
              ${artifact.contentType ? `<span>${escapeHtml(artifact.contentType)}</span>` : ''}
            </div>
            ${artifact.r2Key ? `<div class="artifact-key">${escapeHtml(artifact.r2Key)}</div>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  // ===== View Management =====
  function showView(viewName) {
    state.currentView = viewName;

    elements.requestsView.classList.toggle('hidden', viewName !== 'requests');
    elements.detailView.classList.toggle('hidden', viewName !== 'detail');
  }

  // ===== Data Loading =====
  async function loadRequests() {
    setLoading(true);
    clearError();

    try {
      const data = await fetchRequests();
      state.requests = data.requests || [];
      // Logger returns meta.count for current page, not total
      const count = data.meta?.count || state.requests.length;
      state.pagination.hasMore = count >= CONFIG.pageSize;
      // Calculate approximate total from offset + count
      state.pagination.total = state.pagination.hasMore
        ? state.pagination.offset + count + '+'
        : state.pagination.offset + count;

      renderRequestList();
      renderPagination();
    } catch (err) {
      showError(`Failed to load requests: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadRequestDetail(requestId) {
    setLoading(true);
    clearError();

    try {
      const data = await fetchRequestDetail(requestId);
      state.selectedRequest = data;
      showView('detail');
      renderDetailView();
    } catch (err) {
      showError(`Failed to load request: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  // ===== UI State =====
  function setLoading(loading) {
    state.loading = loading;
    elements.loadingOverlay.classList.toggle('hidden', !loading);
  }

  function showError(message) {
    state.error = message;
    elements.errorMessage.textContent = message;
    elements.errorBanner.classList.remove('hidden');
  }

  function clearError() {
    state.error = null;
    elements.errorBanner.classList.add('hidden');
  }

  function showToast(message) {
    // Simple toast implementation - reuse error banner briefly
    const originalMessage = elements.errorMessage.textContent;
    elements.errorMessage.textContent = message;
    elements.errorBanner.style.background = 'var(--accent-emerald-dim)';
    elements.errorBanner.style.borderColor = 'var(--accent-emerald)';
    elements.errorBanner.style.color = 'var(--accent-emerald)';
    elements.errorBanner.classList.remove('hidden');

    setTimeout(() => {
      elements.errorBanner.classList.add('hidden');
      elements.errorBanner.style.background = '';
      elements.errorBanner.style.borderColor = '';
      elements.errorBanner.style.color = '';
      elements.errorMessage.textContent = originalMessage;
    }, 2000);
  }

  // ===== Auto Refresh =====
  function startAutoRefresh() {
    stopAutoRefresh();
    if (state.settings.autoRefresh && state.currentView === 'requests') {
      refreshTimer = setInterval(() => {
        loadRequests();
      }, state.settings.refreshInterval * 1000);
    }
  }

  function stopAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
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
        // Ignore invalid settings
      }
    }
    elements.autoRefreshToggle.checked = state.settings.autoRefresh;
    elements.refreshInterval.value = state.settings.refreshInterval;
  }

  function saveSettings() {
    localStorage.setItem('warg-dashboard-settings', JSON.stringify(state.settings));
  }

  // ===== Utilities =====
  function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  function formatTime(timestamp) {
    if (!timestamp) return 'Unknown';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return timestamp;

    const now = new Date();
    const diff = now - date;

    // If within last 24 hours, show relative time
    if (diff < 86400000) {
      if (diff < 60000) return 'just now';
      if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
      return `${Math.floor(diff / 3600000)}h ago`;
    }

    // Otherwise show date and time
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function debounce(fn, ms) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // ===== Event Handlers =====
  function setupEventHandlers() {
    // Refresh button
    elements.refreshBtn.addEventListener('click', () => {
      if (state.currentView === 'requests') {
        loadRequests();
      } else if (state.currentView === 'detail' && state.selectedRequest) {
        loadRequestDetail(state.selectedRequest.requestId);
      }
    });

    // Auto-refresh toggle
    elements.autoRefreshToggle.addEventListener('change', (e) => {
      state.settings.autoRefresh = e.target.checked;
      saveSettings();
      if (e.target.checked) {
        startAutoRefresh();
      } else {
        stopAutoRefresh();
      }
    });

    // Domain filter
    elements.domainFilter.addEventListener('input', debounce((e) => {
      state.filters.domain = e.target.value.trim();
      state.pagination.offset = 0;
      loadRequests();
    }, 300));

    // Status filter
    elements.statusFilter.addEventListener('change', (e) => {
      state.filters.status = e.target.value;
      state.pagination.offset = 0;
      loadRequests();
    });

    // Pagination
    elements.prevPage.addEventListener('click', () => {
      if (state.pagination.offset > 0) {
        state.pagination.offset = Math.max(0, state.pagination.offset - CONFIG.pageSize);
        loadRequests();
      }
    });

    elements.nextPage.addEventListener('click', () => {
      if (state.pagination.hasMore) {
        state.pagination.offset += CONFIG.pageSize;
        loadRequests();
      }
    });

    // Back button
    elements.backBtn.addEventListener('click', () => {
      showView('requests');
      state.selectedRequest = null;
      startAutoRefresh();
    });

    // Error close
    elements.errorClose.addEventListener('click', clearError);

    // Settings modal
    elements.settingsBtn.addEventListener('click', () => {
      elements.refreshInterval.value = state.settings.refreshInterval;
      elements.settingsModal.classList.remove('hidden');
    });

    elements.settingsClose.addEventListener('click', () => {
      elements.settingsModal.classList.add('hidden');
    });

    elements.settingsCancel.addEventListener('click', () => {
      elements.settingsModal.classList.add('hidden');
    });

    elements.settingsSave.addEventListener('click', () => {
      state.settings.refreshInterval = parseInt(elements.refreshInterval.value, 10) || CONFIG.defaultRefreshInterval;
      saveSettings();
      if (state.settings.autoRefresh) {
        startAutoRefresh();
      }
      elements.settingsModal.classList.add('hidden');
    });

    // Close modal on overlay click
    elements.settingsModal.addEventListener('click', (e) => {
      if (e.target === elements.settingsModal) {
        elements.settingsModal.classList.add('hidden');
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Escape to go back or close modal
      if (e.key === 'Escape') {
        if (!elements.settingsModal.classList.contains('hidden')) {
          elements.settingsModal.classList.add('hidden');
        } else if (state.currentView === 'detail') {
          showView('requests');
          state.selectedRequest = null;
          startAutoRefresh();
        }
      }
      // R to refresh
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey && e.target.tagName !== 'INPUT') {
        elements.refreshBtn.click();
      }
    });
  }

  // ===== Initialize =====
  function init() {
    loadSettings();
    setupEventHandlers();
    loadRequests();

    if (state.settings.autoRefresh) {
      startAutoRefresh();
    }
  }

  // Start the app
  init();
})();
