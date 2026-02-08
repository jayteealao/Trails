// Warg Observatory - Dashboard Application

(function () {
  'use strict';

  // ===== Configuration =====
  const CONFIG = {
    apiBase: '/api',
    pageSize: 50,
    defaultRefreshInterval: 30,
  };

  // Stage color mapping for charts
  const STAGE_COLORS = {
    done: 'var(--accent-emerald)',
    failed: 'var(--accent-rose)',
    rendering: 'var(--accent-cyan)',
    deriving: 'var(--accent-violet)',
    persisting: 'var(--accent-amber)',
    queued: 'var(--accent-slate)',
  };

  // ===== State =====
  const state = {
    currentView: 'overview',
    requests: [],
    selectedRequest: null,
    stats: null,
    infra: null,
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
    overviewView: document.getElementById('overviewView'),
    requestsView: document.getElementById('requestsView'),
    detailView: document.getElementById('detailView'),
    infraView: document.getElementById('infraView'),
    // Nav
    navItems: document.querySelectorAll('.nav-item[data-view]'),
    // Overview
    statTotal: document.getElementById('statTotal'),
    statSuccessRate: document.getElementById('statSuccessRate'),
    statActive: document.getElementById('statActive'),
    statStuck: document.getElementById('statStuck'),
    statLast1h: document.getElementById('statLast1h'),
    statLast24h: document.getElementById('statLast24h'),
    stageBars: document.getElementById('stageBars'),
    topDomains: document.getElementById('topDomains'),
    recentFailures: document.getElementById('recentFailures'),
    refreshStatsBtn: document.getElementById('refreshStatsBtn'),
    // Infra
    workersGrid: document.getElementById('workersGrid'),
    workflowsGrid: document.getElementById('workflowsGrid'),
    d1Panel: document.getElementById('d1Panel'),
    r2Panel: document.getElementById('r2Panel'),
    doPanel: document.getElementById('doPanel'),
    refreshInfraBtn: document.getElementById('refreshInfraBtn'),
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

  async function fetchStats() {
    const data = await apiRequest('/stats');
    return data;
  }

  async function fetchInfra() {
    const data = await apiRequest('/infra');
    return data;
  }

  // ===== Render Functions =====

  // --- Overview ---
  function renderStats() {
    const s = state.stats;
    if (!s) return;

    elements.statTotal.textContent = s.total.toLocaleString();
    elements.statSuccessRate.textContent = (s.successRate * 100).toFixed(1) + '%';
    elements.statActive.textContent = s.activeCount.toLocaleString();
    elements.statStuck.textContent = s.stuckCount.toLocaleString();
    elements.statLast1h.textContent = s.recentActivity.last1h.toLocaleString();
    elements.statLast24h.textContent = s.recentActivity.last24h.toLocaleString();

    // Highlight stuck count if non-zero
    const stuckCard = elements.statStuck.closest('.stat-card');
    if (stuckCard) {
      stuckCard.classList.toggle('stat-card-warning', s.stuckCount > 0);
    }

    renderStageBars(s.byStage, s.total);
    renderTopDomains(s.topDomains);
    renderRecentFailures(s.recentFailures);
  }

  function renderStageBars(byStage, total) {
    if (!byStage || total === 0) {
      elements.stageBars.innerHTML = '<div class="empty-state"><div class="empty-state-text">No data</div></div>';
      return;
    }

    const stages = Object.entries(byStage).sort((a, b) => b[1] - a[1]);

    elements.stageBars.innerHTML = stages.map(([stage, count]) => {
      const pct = total > 0 ? (count / total * 100).toFixed(1) : 0;
      const color = STAGE_COLORS[stage] || 'var(--text-muted)';
      return `
        <div class="stage-bar-row">
          <div class="stage-bar-label">
            <span class="status-badge status-${escapeHtml(stage)}">${escapeHtml(stage)}</span>
            <span class="stage-bar-count">${count.toLocaleString()}</span>
          </div>
          <div class="stage-bar-track">
            <div class="stage-bar-fill" style="width:${pct}%;background:${color}"></div>
          </div>
          <span class="stage-bar-pct">${pct}%</span>
        </div>
      `;
    }).join('');
  }

  function renderTopDomains(domains) {
    if (!domains || domains.length === 0) {
      elements.topDomains.innerHTML = '<div class="empty-state"><div class="empty-state-text">No domains</div></div>';
      return;
    }

    const maxCount = domains[0].count;

    elements.topDomains.innerHTML = domains.map(d => {
      const pct = maxCount > 0 ? (d.count / maxCount * 100) : 0;
      return `
        <div class="domain-row">
          <span class="domain-name">${escapeHtml(d.domain)}</span>
          <div class="domain-bar-track">
            <div class="domain-bar-fill" style="width:${pct}%"></div>
          </div>
          <span class="domain-count">${d.count.toLocaleString()}</span>
        </div>
      `;
    }).join('');
  }

  function renderRecentFailures(failures) {
    if (!failures || failures.length === 0) {
      elements.recentFailures.innerHTML = '<div class="empty-state"><div class="empty-state-text">No recent failures</div></div>';
      return;
    }

    elements.recentFailures.innerHTML = failures.map(f => `
      <div class="failure-row" data-id="${escapeHtml(f.requestId)}">
        <div class="failure-url">${escapeHtml(f.url)}</div>
        <div class="failure-meta">
          <span class="failure-time">${formatTime(f.createdAt)}</span>
          <span class="failure-id">${escapeHtml(f.requestId.slice(0, 8))}...</span>
        </div>
      </div>
    `).join('');

    // Click to navigate to detail
    elements.recentFailures.querySelectorAll('.failure-row').forEach(row => {
      row.addEventListener('click', () => {
        loadRequestDetail(row.dataset.id);
      });
    });
  }

  // --- Infrastructure ---
  function renderInfra() {
    const infra = state.infra;
    if (!infra) return;

    renderWorkersGrid(infra.workers);
    renderWorkflowsGrid(infra.workflows);
    renderD1Panel(infra.d1);
    renderR2Panel(infra.r2);
    renderDOPanel(infra.durableObjects);
  }

  function renderWorkersGrid(workers) {
    if (!workers || workers.length === 0) {
      elements.workersGrid.innerHTML = '<div class="empty-state"><div class="empty-state-text">No worker data</div></div>';
      return;
    }

    elements.workersGrid.innerHTML = workers.map(w => {
      const errorRate = w.requests > 0 ? (w.errors / w.requests * 100).toFixed(1) : '0.0';
      const errorClass = parseFloat(errorRate) > 5 ? 'infra-metric-bad' : parseFloat(errorRate) > 1 ? 'infra-metric-warn' : 'infra-metric-ok';

      return `
        <div class="infra-card">
          <div class="infra-card-header">
            <span class="infra-card-name">${escapeHtml(w.scriptName)}</span>
            <span class="infra-card-indicator ${errorClass}"></span>
          </div>
          <div class="infra-metrics">
            <div class="infra-metric">
              <span class="infra-metric-value">${formatNumber(w.requests)}</span>
              <span class="infra-metric-label">Requests</span>
            </div>
            <div class="infra-metric">
              <span class="infra-metric-value ${errorClass}">${errorRate}%</span>
              <span class="infra-metric-label">Error Rate</span>
            </div>
            <div class="infra-metric">
              <span class="infra-metric-value">${w.cpuP50 != null ? w.cpuP50 + 'ms' : '--'}</span>
              <span class="infra-metric-label">CPU p50</span>
            </div>
            <div class="infra-metric">
              <span class="infra-metric-value">${w.cpuP99 != null ? w.cpuP99 + 'ms' : '--'}</span>
              <span class="infra-metric-label">CPU p99</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderWorkflowsGrid(workflows) {
    if (!workflows) {
      elements.workflowsGrid.innerHTML = '<div class="empty-state"><div class="empty-state-text">No workflow data</div></div>';
      return;
    }

    const statuses = workflows.statusCounts || {};
    const entries = Object.entries(statuses);

    if (entries.length === 0) {
      elements.workflowsGrid.innerHTML = '<div class="empty-state"><div class="empty-state-text">No workflow instances</div></div>';
      return;
    }

    elements.workflowsGrid.innerHTML = `
      <div class="infra-card infra-card-wide">
        <div class="infra-card-header">
          <span class="infra-card-name">Archive Workflow</span>
        </div>
        <div class="infra-metrics">
          ${entries.map(([status, count]) => {
            const cls = status === 'errored' ? 'infra-metric-bad' : status === 'running' || status === 'queued' ? 'infra-metric-active' : '';
            return `
              <div class="infra-metric">
                <span class="infra-metric-value ${cls}">${count}</span>
                <span class="infra-metric-label">${escapeHtml(status)}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  function renderD1Panel(d1) {
    if (!d1) {
      elements.d1Panel.innerHTML = '<div class="empty-state"><div class="empty-state-text">No D1 data</div></div>';
      return;
    }

    elements.d1Panel.innerHTML = `
      <div class="infra-metrics infra-metrics-vertical">
        <div class="infra-metric">
          <span class="infra-metric-value">${formatNumber(d1.queryCount)}</span>
          <span class="infra-metric-label">Queries (24h)</span>
        </div>
        <div class="infra-metric">
          <span class="infra-metric-value">${formatNumber(d1.rowsRead)}</span>
          <span class="infra-metric-label">Rows Read</span>
        </div>
        <div class="infra-metric">
          <span class="infra-metric-value">${d1.databaseSize ? formatBytes(d1.databaseSize) : '--'}</span>
          <span class="infra-metric-label">DB Size</span>
        </div>
      </div>
    `;
  }

  function renderR2Panel(r2) {
    if (!r2) {
      elements.r2Panel.innerHTML = '<div class="empty-state"><div class="empty-state-text">No R2 data</div></div>';
      return;
    }

    elements.r2Panel.innerHTML = `
      <div class="infra-metrics infra-metrics-vertical">
        <div class="infra-metric">
          <span class="infra-metric-value">${r2.bucketSize ? formatBytes(r2.bucketSize) : '--'}</span>
          <span class="infra-metric-label">Bucket Size</span>
        </div>
        <div class="infra-metric">
          <span class="infra-metric-value">${formatNumber(r2.objectCount)}</span>
          <span class="infra-metric-label">Objects</span>
        </div>
        <div class="infra-metric">
          <span class="infra-metric-value">${formatNumber(r2.operationCount)}</span>
          <span class="infra-metric-label">Ops (24h)</span>
        </div>
      </div>
    `;
  }

  function renderDOPanel(doData) {
    if (!doData) {
      elements.doPanel.innerHTML = '<div class="empty-state"><div class="empty-state-text">No DO data</div></div>';
      return;
    }

    elements.doPanel.innerHTML = `
      <div class="infra-metrics">
        <div class="infra-metric">
          <span class="infra-metric-value">${doData.storageBytes ? formatBytes(doData.storageBytes) : '--'}</span>
          <span class="infra-metric-label">Storage</span>
        </div>
        <div class="infra-metric">
          <span class="infra-metric-value">${formatNumber(doData.requestCount)}</span>
          <span class="infra-metric-label">Requests (24h)</span>
        </div>
      </div>
    `;
  }

  // --- Request List ---
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

    elements.overviewView.classList.toggle('hidden', viewName !== 'overview');
    elements.requestsView.classList.toggle('hidden', viewName !== 'requests');
    elements.detailView.classList.toggle('hidden', viewName !== 'detail');
    elements.infraView.classList.toggle('hidden', viewName !== 'infra');

    // Update nav active state
    elements.navItems.forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewName);
    });
  }

  // ===== Data Loading =====
  async function loadStats() {
    setLoading(true);
    clearError();

    try {
      const data = await fetchStats();
      state.stats = data;
      renderStats();
    } catch (err) {
      showError(`Failed to load stats: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadInfra() {
    setLoading(true);
    clearError();

    try {
      const data = await fetchInfra();
      state.infra = data;
      renderInfra();
    } catch (err) {
      showError(`Failed to load infrastructure data: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

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
    if (state.settings.autoRefresh) {
      refreshTimer = setInterval(() => {
        refreshCurrentView();
      }, state.settings.refreshInterval * 1000);
    }
  }

  function stopAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  function refreshCurrentView() {
    if (state.currentView === 'overview') {
      loadStats();
    } else if (state.currentView === 'requests') {
      loadRequests();
    } else if (state.currentView === 'infra') {
      loadInfra();
    } else if (state.currentView === 'detail' && state.selectedRequest) {
      loadRequestDetail(state.selectedRequest.requestId);
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
    if (bytes == null) return '--';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatNumber(n) {
    if (n == null) return '--';
    return n.toLocaleString();
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
    // Navigation
    elements.navItems.forEach(item => {
      item.addEventListener('click', () => {
        const view = item.dataset.view;
        showView(view);
        // Load data for the view if needed
        if (view === 'overview' && !state.stats) {
          loadStats();
        } else if (view === 'requests' && state.requests.length === 0) {
          loadRequests();
        } else if (view === 'infra' && !state.infra) {
          loadInfra();
        }
      });
    });

    // Refresh buttons
    elements.refreshBtn.addEventListener('click', () => {
      if (state.currentView === 'requests') {
        loadRequests();
      } else if (state.currentView === 'detail' && state.selectedRequest) {
        loadRequestDetail(state.selectedRequest.requestId);
      }
    });

    elements.refreshStatsBtn.addEventListener('click', () => {
      loadStats();
    });

    elements.refreshInfraBtn.addEventListener('click', () => {
      loadInfra();
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
        refreshCurrentView();
      }
    });
  }

  // ===== Initialize =====
  function init() {
    loadSettings();
    setupEventHandlers();

    // Start on overview
    showView('overview');
    loadStats();

    if (state.settings.autoRefresh) {
      startAutoRefresh();
    }
  }

  // Start the app
  init();
})();
