// Warg Observatory Dashboard

(function () {
  'use strict';

  // ===== Configuration =====
  const CONFIG = {
    apiBase: '/api',
    pageSize: 50,
    defaultRefreshInterval: 30,
    feedPollInterval: 10000,
    feedMaxItems: 200,
  };

  const STAGE_COLORS = {
    done: 'var(--stage-done)',
    failed: 'var(--stage-failed)',
    rendering: 'var(--stage-rendering)',
    deriving: 'var(--stage-deriving)',
    persisting: 'var(--stage-persisting)',
    queued: 'var(--stage-queued)',
  };

  const PIPELINE_STEPS = [
    { id: 'render', label: 'Render', source: 'renderer' },
    { id: 'singlefile', label: 'Singlefile', source: 'singlefile' },
    { id: 'readability', label: 'Readability', source: 'readability' },
    { id: 'monolith', label: 'Monolith', source: 'monolith' },
    { id: 'persist', label: 'Persist', source: 'gcs' },
  ];

  // Maps archive keys to workflow steps (for selective re-archiving)
  const ARCHIVE_KEY_TO_STEP = {
    rendered: 'render',
    screenshot: 'render',
    pdf: 'render',
    singlefile: 'singlefile',
    readability: 'readability',
    markdown: 'readability',
    monolith: 'monolith',
  };

  const VIEW_TITLES = {
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

  // ===== State =====
  const state = {
    currentView: 'overview',
    previousView: null,
    requests: [],
    selectedRequest: null,
    stats: null,
    infra: null,
    errors: null,
    filters: { domain: '', status: '' },
    pagination: { offset: 0, total: 0, hasMore: false },
    settings: { autoRefresh: false, refreshInterval: CONFIG.defaultRefreshInterval },
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
  };

  let refreshTimer = null;
  let feedTimer = null;
  let clockTimer = null;

  // ===== DOM Elements =====
  const el = {
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
    statusFilter: document.getElementById('statusFilter'),
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
    // Settings
    settingsBtn: document.getElementById('settingsBtn'),
    settingsModal: document.getElementById('settingsModal'),
    settingsClose: document.getElementById('settingsClose'),
    settingsCancel: document.getElementById('settingsCancel'),
    settingsSave: document.getElementById('settingsSave'),
    refreshInterval: document.getElementById('refreshInterval'),
  };

  // ===== API Client =====
  async function apiRequest(endpoint, options) {
    const response = await fetch(`${CONFIG.apiBase}${endpoint}`, options);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `HTTP ${response.status}`);
    }
    return response.json();
  }

  async function fetchRequests() {
    const params = new URLSearchParams();
    if (state.filters.domain) params.set('domain', state.filters.domain);
    if (state.filters.status) params.set('status', state.filters.status);
    params.set('limit', CONFIG.pageSize);
    params.set('offset', state.pagination.offset);
    return apiRequest(`/requests?${params}`);
  }

  async function fetchRequestDetail(requestId) {
    return apiRequest(`/${requestId}`);
  }

  async function fetchStats() {
    return apiRequest('/stats');
  }

  async function fetchInfra() {
    return apiRequest('/infra');
  }

  async function submitArchive(url, options) {
    const body = { url };
    if (options) Object.assign(body, options);
    return apiRequest('/begin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  // ===== Utility Functions =====
  function escapeHtml(str) {
    if (str === undefined || str === null) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  function truncateUrl(url, max = 60) {
    if (!url || url.length <= max) return url || '';
    return url.slice(0, max - 1) + '\u2026';
  }

  function formatTimeShort(timestamp) {
    if (!timestamp) return '--';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return timestamp;
    const now = new Date();
    const diff = now - date;
    if (diff < 60000) return 'now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function formatTimeFeedLine(timestamp) {
    if (!timestamp) return '--:--:--';
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return '--:--:--';
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function formatDuration(ms) {
    if (ms == null || ms < 0) return '--';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }

  function formatTime(timestamp) {
    if (!timestamp) return '--';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return timestamp;
    const now = new Date();
    const diff = now - date;
    if (diff < 86400000) {
      if (diff < 60000) return 'just now';
      if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
      return `${Math.floor(diff / 3600000)}h ago`;
    }
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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

  function getDomain(url) {
    try { return new URL(url).hostname; } catch { return 'unknown'; }
  }

  function startSystemClock() {
    function update() {
      const now = new Date();
      el.systemClock.textContent = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    }
    update();
    clockTimer = setInterval(update, 1000);
  }

  // ===== Status Badge =====
  function statusBadgeHtml(stage) {
    return `<span class="status-badge status-${escapeHtml(stage)}"><span class="led"></span>${escapeHtml(stage)}</span>`;
  }

  // ===== Render: Overview =====
  function renderStats() {
    const s = state.stats;
    if (!s) return;

    el.statTotal.textContent = s.total.toLocaleString();
    el.statSuccessRate.textContent = (s.successRate * 100).toFixed(1) + '%';
    el.statActive.textContent = s.activeCount.toLocaleString();
    el.statStuck.textContent = s.stuckCount.toLocaleString();
    el.statLast1h.textContent = s.recentActivity.last1h.toLocaleString();
    el.statLast24h.textContent = s.recentActivity.last24h.toLocaleString();

    renderSegmentedBar(s.byStage, s.total);
    renderTopDomains(s.topDomains);
    renderRecentFailures(s.recentFailures);
  }

  function renderSegmentedBar(byStage, total) {
    if (!byStage || total === 0) {
      el.segmentedBar.innerHTML = '';
      el.segmentedLegend.innerHTML = '<span class="legend-item" style="color:var(--text-3)">No data</span>';
      return;
    }

    const stages = Object.entries(byStage).sort((a, b) => b[1] - a[1]);

    el.segmentedBar.innerHTML = stages.map(([stage, count]) => {
      const pct = (count / total * 100);
      const color = STAGE_COLORS[stage] || 'var(--text-3)';
      return `<div class="stage-bar-segment" style="width:${pct}%;background:${color}" title="${stage}: ${count} (${pct.toFixed(1)}%)"></div>`;
    }).join('');

    el.segmentedLegend.innerHTML = stages.map(([stage, count]) => {
      const color = STAGE_COLORS[stage] || 'var(--text-3)';
      const pct = (count / total * 100).toFixed(1);
      return `<span class="legend-item"><span class="legend-swatch" style="background:${color}"></span>${stage} ${count} (${pct}%)</span>`;
    }).join('');
  }

  function renderTopDomains(domains) {
    if (!domains || domains.length === 0) {
      el.topDomains.innerHTML = '<div class="empty-state">No domains</div>';
      return;
    }

    el.topDomains.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Domain</th><th class="td-right">Count</th></tr></thead>
        <tbody>
          ${domains.map(d => `
            <tr>
              <td>${escapeHtml(d.domain)}</td>
              <td class="td-right">${d.count.toLocaleString()}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function renderRecentFailures(failures) {
    if (!failures || failures.length === 0) {
      el.recentFailures.innerHTML = '<div class="empty-state">No failures</div>';
      return;
    }

    el.recentFailures.innerHTML = `
      <table class="data-table">
        <thead><tr><th>URL</th><th>ID</th><th>Time</th></tr></thead>
        <tbody>
          ${failures.map(f => `
            <tr class="clickable" data-id="${escapeHtml(f.requestId)}">
              <td class="td-url">${escapeHtml(truncateUrl(f.url, 40))}</td>
              <td class="td-id">${escapeHtml(f.requestId.slice(0, 8))}</td>
              <td>${formatTimeShort(f.createdAt)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    el.recentFailures.querySelectorAll('tr.clickable').forEach(row => {
      row.addEventListener('click', () => loadRequestDetail(row.dataset.id));
    });
  }

  // ===== Render: Infrastructure =====
  function renderInfra() {
    const infra = state.infra;
    if (!infra) return;
    renderWorkersTable(infra.workers);
    renderWorkflowsPanel(infra.workflows);
    renderStoragePanel(infra);
  }

  function renderWorkersTable(workers) {
    if (!workers || workers.length === 0) {
      el.workersPanel.innerHTML = '<div class="empty-state">No worker data</div>';
      return;
    }

    el.workersPanel.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Worker</th>
            <th class="td-right">Requests</th>
            <th class="td-right">Error Rate</th>
            <th class="td-right">CPU p50</th>
            <th class="td-right">CPU p99</th>
            <th>Health</th>
          </tr>
        </thead>
        <tbody>
          ${workers.map(w => {
            const errorRate = w.requests > 0 ? (w.errors / w.requests * 100).toFixed(1) : '0.0';
            const healthClass = parseFloat(errorRate) > 5 ? 'metric-bad' : parseFloat(errorRate) > 1 ? 'metric-warn' : 'metric-ok';
            return `
              <tr>
                <td>${escapeHtml(w.scriptName)}</td>
                <td class="td-right">${formatNumber(w.requests)}</td>
                <td class="td-right ${healthClass}">${errorRate}%</td>
                <td class="td-right">${w.cpuP50 != null ? w.cpuP50 + 'ms' : '--'}</td>
                <td class="td-right">${w.cpuP99 != null ? w.cpuP99 + 'ms' : '--'}</td>
                <td><span class="archive-dot archive-dot-${parseFloat(errorRate) > 5 ? 'failed' : parseFloat(errorRate) > 1 ? 'pending' : 'success'}"></span></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  function renderWorkflowsPanel(workflows) {
    if (!workflows) {
      el.workflowsPanel.innerHTML = '<div class="empty-state">No workflow data</div>';
      return;
    }

    const statuses = workflows.statusCounts || {};
    const entries = Object.entries(statuses);

    if (entries.length === 0) {
      el.workflowsPanel.innerHTML = '<div class="empty-state">No workflow instances</div>';
      return;
    }

    el.workflowsPanel.innerHTML = `
      <div class="infra-metrics-strip">
        ${entries.map(([status, count]) => {
          const cls = status === 'errored' ? 'metric-bad' : (status === 'running' || status === 'queued') ? 'metric-active' : '';
          return `
            <div class="infra-metric-cell">
              <div class="infra-metric-value ${cls}">${count}</div>
              <div class="infra-metric-label">${escapeHtml(status)}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderStoragePanel(infra) {
    const d1 = infra.d1;
    const r2 = infra.r2;
    const doData = infra.durableObjects;

    const cells = [];
    if (d1) {
      cells.push({ label: 'D1 Queries', value: formatNumber(d1.queryCount) });
      cells.push({ label: 'D1 Rows', value: formatNumber(d1.rowsRead) });
      cells.push({ label: 'D1 Size', value: d1.databaseSize ? formatBytes(d1.databaseSize) : '--' });
    }
    if (r2) {
      cells.push({ label: 'R2 Size', value: r2.bucketSize ? formatBytes(r2.bucketSize) : '--' });
      cells.push({ label: 'R2 Objects', value: formatNumber(r2.objectCount) });
      cells.push({ label: 'R2 Ops', value: formatNumber(r2.operationCount) });
    }
    if (doData) {
      cells.push({ label: 'DO Storage', value: doData.storageBytes ? formatBytes(doData.storageBytes) : '--' });
      cells.push({ label: 'DO Requests', value: formatNumber(doData.requestCount) });
    }

    if (cells.length === 0) {
      el.storagePanel.innerHTML = '<div class="empty-state">No storage data</div>';
      return;
    }

    el.storagePanel.innerHTML = `
      <div class="infra-metrics-strip">
        ${cells.map(c => `
          <div class="infra-metric-cell">
            <div class="infra-metric-value">${c.value}</div>
            <div class="infra-metric-label">${escapeHtml(c.label)}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // ===== Render: Requests Table =====
  function renderRequestTable() {
    if (state.requests.length === 0) {
      el.requestTableBody.innerHTML = `<tr><td colspan="6" class="empty-state">No requests found</td></tr>`;
      return;
    }

    el.requestTableBody.innerHTML = state.requests.map(req => {
      const errorCount = req.errorCount || 0;
      const stage = req.stage || 'queued';
      const domain = req.domain || getDomain(req.url);

      return `
        <tr class="clickable" data-id="${escapeHtml(req.requestId)}">
          <td class="td-id">${escapeHtml(req.requestId.slice(0, 8))}</td>
          <td class="td-url">${escapeHtml(truncateUrl(req.url, 60))}</td>
          <td>${escapeHtml(domain)}</td>
          <td>${statusBadgeHtml(stage)}</td>
          <td>${errorCount > 0 ? `<span class="error-count">${errorCount}</span>` : '<span style="color:var(--text-3)">0</span>'}</td>
          <td>${formatTimeShort(req.createdAt)}</td>
        </tr>
      `;
    }).join('');

    el.requestTableBody.querySelectorAll('tr.clickable').forEach(row => {
      row.addEventListener('click', () => loadRequestDetail(row.dataset.id));
    });
  }

  function renderPagination() {
    const start = state.pagination.offset + 1;
    const end = state.pagination.offset + state.requests.length;
    const total = state.pagination.total || '?';

    el.paginationInfo.textContent = state.requests.length > 0
      ? `${start}-${end} of ${total}`
      : 'No results';

    el.prevPage.disabled = state.pagination.offset === 0;
    el.nextPage.disabled = !state.pagination.hasMore;
  }

  // ===== Render: Detail View =====
  function renderDetailView() {
    const req = state.selectedRequest;
    if (!req) {
      el.detailContent.innerHTML = '<div class="empty-state">Request not found</div>';
      return;
    }

    const stage = req.derived?.stage || 'queued';
    const events = req.events || [];
    const artifacts = req.artifacts || [];
    const domain = req.url ? getDomain(req.url) : 'unknown';

    const pipelineHtml = renderPipeline(events);

    el.detailContent.innerHTML = `
      <div class="detail-grid">
        ${pipelineHtml}

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
              ${statusBadgeHtml(stage)}
            </div>
            <div class="detail-meta-item">
              <span class="detail-meta-label">Created</span>
              <span class="detail-meta-value">${formatTime(req.createdAt)}</span>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">Events Timeline</span>
            <span class="card-count">${events.length} events</span>
          </div>
          <div class="card-body">
            ${renderTimeline(events)}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">Artifacts</span>
            <span class="card-count">${artifacts.length}</span>
          </div>
          <div class="card-body">
            ${renderArtifacts(artifacts)}
          </div>
        </div>
      </div>
    `;

    el.detailContent.querySelectorAll('.copyable').forEach(copyEl => {
      copyEl.addEventListener('click', () => {
        navigator.clipboard.writeText(copyEl.dataset.copy).then(() => {
          showToast('Copied to clipboard');
        });
      });
    });
  }

  // ===== Pipeline Visualizer =====
  function derivePipelineState(events) {
    const steps = {};
    for (const step of PIPELINE_STEPS) {
      steps[step.id] = {
        status: 'pending',
        startedAt: null,
        completedAt: null,
        elapsed: null,
        attempts: 0,
        error: null,
      };
    }

    for (const event of events) {
      const step = PIPELINE_STEPS.find(s => s.source === event.source);
      if (!step) continue;

      const s = steps[step.id];

      if (event.type === 'step.started') {
        s.status = 'running';
        s.startedAt = s.startedAt || event.ts;
        s.attempts++;
      } else if (event.type === 'step.completed') {
        s.status = 'complete';
        s.completedAt = event.ts;
        if (s.startedAt) {
          s.elapsed = new Date(event.ts) - new Date(s.startedAt);
        }
      } else if (event.type === 'step.failed') {
        s.status = 'failed';
        s.completedAt = event.ts;
        s.error = event.message || 'Failed';
        if (s.startedAt) {
          s.elapsed = new Date(event.ts) - new Date(s.startedAt);
        }
      }
    }

    return steps;
  }

  function renderPipeline(events) {
    const steps = derivePipelineState(events);

    const parts = [];
    for (let i = 0; i < PIPELINE_STEPS.length; i++) {
      const def = PIPELINE_STEPS[i];
      const s = steps[def.id];
      const stepClass = `step-${s.status}`;

      parts.push(`
        <div class="pipeline-step ${stepClass}">
          <div class="pipeline-node"><div class="pipeline-node-inner"></div></div>
          <div class="pipeline-label">${def.label}</div>
          ${s.elapsed != null ? `<div class="pipeline-timing">${formatDuration(s.elapsed)}</div>` : ''}
          ${s.attempts > 1 ? `<div class="pipeline-attempts">x${s.attempts}</div>` : ''}
        </div>
      `);

      if (i < PIPELINE_STEPS.length - 1) {
        const nextDef = PIPELINE_STEPS[i + 1];
        const nextS = steps[nextDef.id];
        const connActive = s.status === 'complete' && nextS.status !== 'pending';
        parts.push(`<div class="pipeline-connector ${connActive ? 'connector-active' : ''}"></div>`);
      }
    }

    return `<div class="pipeline">${parts.join('')}</div>`;
  }

  function renderTimeline(events) {
    if (events.length === 0) {
      return '<div class="empty-state">No events recorded</div>';
    }

    const sorted = [...events].sort((a, b) => new Date(a.ts) - new Date(b.ts));

    return `
      <div class="timeline">
        ${sorted.map(event => {
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
      return '<div class="empty-state">No artifacts generated</div>';
    }

    return `
      <div class="artifacts-grid">
        ${artifacts.map(a => `
          <div class="artifact-card">
            <div class="artifact-kind">${escapeHtml(a.kind || 'unknown')}</div>
            <div class="artifact-meta">
              ${a.bytes ? `<span>${formatBytes(a.bytes)}</span>` : ''}
              ${a.contentType ? `<span>${escapeHtml(a.contentType)}</span>` : ''}
            </div>
            ${a.r2Key ? `<div class="artifact-key">${escapeHtml(a.r2Key)}</div>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  // ===== Render: Feed =====
  function renderFeed() {
    if (state.feed.items.length === 0) {
      el.feedContainer.innerHTML = '<div class="empty-state">Waiting for requests</div>';
      return;
    }

    el.feedContainer.innerHTML = state.feed.items.map(item => {
      const stage = item.stage || 'queued';
      const domain = item.domain || getDomain(item.url);
      const isNew = item._new;
      return `
        <div class="feed-line ${isNew ? 'feed-new' : ''}" data-id="${escapeHtml(item.requestId)}">
          <span class="feed-time">${formatTimeFeedLine(item.createdAt)}</span>
          <span class="feed-id">${escapeHtml(item.requestId.slice(0, 8))}</span>
          <span class="feed-status">${statusBadgeHtml(stage)}</span>
          <span class="feed-domain">${escapeHtml(domain)}</span>
          <span class="feed-url">${escapeHtml(truncateUrl(item.url, 80))}</span>
        </div>
      `;
    }).join('');

    el.feedContainer.querySelectorAll('.feed-line').forEach(line => {
      line.addEventListener('click', () => loadRequestDetail(line.dataset.id));
    });

    el.feedCount.textContent = `${state.feed.items.length} requests`;
  }

  // ===== Render: Errors =====
  function renderErrors() {
    const data = state.errors;
    if (!data) {
      el.errorsContent.innerHTML = '<div class="empty-state">Loading</div>';
      return;
    }

    const { stats, failedRequests, errorsBySource, errorPatterns } = data;

    const total = stats?.total || 0;
    const failureRate = total > 0 ? ((stats?.byStage?.failed || 0) / total * 100).toFixed(1) : '0.0';

    let html = `
      <div class="readout-strip">
        <div class="readout-cell">
          <div class="readout-label">Total Failed</div>
          <div class="readout-value readout-red">${stats?.byStage?.failed || 0}</div>
        </div>
        <div class="readout-cell">
          <div class="readout-label">Failure Rate</div>
          <div class="readout-value readout-red">${failureRate}%</div>
        </div>
        <div class="readout-cell">
          <div class="readout-label">Error Sources</div>
          <div class="readout-value">${Object.keys(errorsBySource).length}</div>
        </div>
        <div class="readout-cell">
          <div class="readout-label">Patterns</div>
          <div class="readout-value">${errorPatterns.length}</div>
        </div>
      </div>
    `;

    const sourceEntries = Object.entries(errorsBySource).sort((a, b) => b[1] - a[1]);
    const maxSourceCount = sourceEntries.length > 0 ? sourceEntries[0][1] : 1;

    if (sourceEntries.length > 0) {
      html += `
        <div class="card">
          <div class="card-header"><span class="card-title">Errors by Source</span></div>
          <div class="card-body card-body-flush">
            <table class="data-table">
              <thead><tr><th>Source</th><th class="td-right">Count</th><th style="min-width:100px">Frequency</th></tr></thead>
              <tbody>
                ${sourceEntries.map(([source, count]) => {
                  const pct = (count / maxSourceCount * 100).toFixed(0);
                  return `
                    <tr>
                      <td>${escapeHtml(source)}</td>
                      <td class="td-right">${count}</td>
                      <td><div class="error-source-bar"><div class="error-source-fill" style="width:${pct}%"></div></div></td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    if (errorPatterns.length > 0) {
      html += `
        <div class="card">
          <div class="card-header"><span class="card-title">Error Patterns</span></div>
          <div class="card-body card-body-flush">
            ${errorPatterns.map(p => `
              <div class="error-pattern-item">
                <div class="error-pattern-msg">${escapeHtml(p.message)}</div>
                <div class="error-pattern-meta">
                  <span>Count: ${p.count}</span>
                  <span>Requests: ${p.requestIds.slice(0, 3).map(id => id.slice(0, 8)).join(', ')}${p.requestIds.length > 3 ? '...' : ''}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    if (failedRequests && failedRequests.length > 0) {
      html += `
        <div class="card">
          <div class="card-header">
            <span class="card-title">Failed Requests</span>
            <span class="card-count">${failedRequests.length}</span>
          </div>
          <div class="card-body card-body-flush">
            <table class="data-table">
              <thead><tr><th>ID</th><th>URL</th><th>Created</th></tr></thead>
              <tbody>
                ${failedRequests.map(r => `
                  <tr class="clickable" data-id="${escapeHtml(r.requestId)}">
                    <td class="td-id">${escapeHtml(r.requestId.slice(0, 8))}</td>
                    <td class="td-url">${escapeHtml(truncateUrl(r.url, 50))}</td>
                    <td>${formatTimeShort(r.createdAt)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    el.errorsContent.innerHTML = html;

    el.errorsContent.querySelectorAll('tr.clickable').forEach(row => {
      row.addEventListener('click', () => loadRequestDetail(row.dataset.id));
    });
  }

  // ===== View Management =====
  function showView(viewName) {
    if (state.currentView !== viewName) {
      state.previousView = state.currentView;
    }
    state.currentView = viewName;

    el.overviewView.classList.toggle('hidden', viewName !== 'overview');
    el.requestsView.classList.toggle('hidden', viewName !== 'requests');
    el.detailView.classList.toggle('hidden', viewName !== 'detail');
    el.infraView.classList.toggle('hidden', viewName !== 'infra');
    el.feedView.classList.toggle('hidden', viewName !== 'feed');
    el.errorsView.classList.toggle('hidden', viewName !== 'errors');
    el.backfillView.classList.toggle('hidden', viewName !== 'backfill');
    el.articlesView.classList.toggle('hidden', viewName !== 'articles');
    el.articleDetailView.classList.toggle('hidden', viewName !== 'articleDetail');

    el.navItems.forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewName);
    });

    // Update page title
    el.pageTitle.textContent = VIEW_TITLES[viewName] || viewName;

    if (viewName === 'feed') {
      state.feed.newCount = 0;
      updateFeedBadge();
    }
  }

  function updateFeedBadge() {
    if (state.feed.newCount > 0 && state.currentView !== 'feed') {
      el.feedBadge.textContent = state.feed.newCount > 99 ? '99+' : state.feed.newCount;
      el.feedBadge.classList.remove('hidden');
    } else {
      el.feedBadge.classList.add('hidden');
    }
  }

  // ===== Data Loading =====
  async function loadStats() {
    setLoading(true);
    clearError();
    try {
      state.stats = await fetchStats();
      renderStats();
    } catch (err) {
      showError(`Stats: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadInfra() {
    setLoading(true);
    clearError();
    try {
      state.infra = await fetchInfra();
      renderInfra();
    } catch (err) {
      showError(`Infra: ${err.message}`);
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
      const count = data.meta?.count || state.requests.length;
      state.pagination.hasMore = count >= CONFIG.pageSize;
      state.pagination.total = state.pagination.hasMore
        ? state.pagination.offset + count + '+'
        : state.pagination.offset + count;
      renderRequestTable();
      renderPagination();
    } catch (err) {
      showError(`Requests: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadRequestDetail(requestId) {
    setLoading(true);
    clearError();
    try {
      state.selectedRequest = await fetchRequestDetail(requestId);
      showView('detail');
      renderDetailView();
    } catch (err) {
      showError(`Detail: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadErrors() {
    setLoading(true);
    clearError();
    try {
      const [stats, failedData] = await Promise.all([
        fetchStats(),
        apiRequest('/requests?status=failed&limit=50'),
      ]);

      const failedRequests = failedData.requests || [];

      const detailPromises = failedRequests.slice(0, 10).map(r =>
        fetchRequestDetail(r.requestId).catch(() => null)
      );
      const details = await Promise.all(detailPromises);

      const errorsBySource = {};
      const patternMap = {};

      for (const detail of details) {
        if (!detail) continue;
        const errorEvents = (detail.events || []).filter(e => e.level === 'error');
        for (const ev of errorEvents) {
          const src = ev.source || 'unknown';
          errorsBySource[src] = (errorsBySource[src] || 0) + 1;

          const key = (ev.message || 'Unknown error').slice(0, 80);
          if (!patternMap[key]) {
            patternMap[key] = { message: key, count: 0, requestIds: [] };
          }
          patternMap[key].count++;
          if (!patternMap[key].requestIds.includes(detail.requestId)) {
            patternMap[key].requestIds.push(detail.requestId);
          }
        }
      }

      const errorPatterns = Object.values(patternMap).sort((a, b) => b.count - a.count);

      state.errors = { stats, failedRequests, errorsBySource, errorPatterns };
      renderErrors();
    } catch (err) {
      showError(`Errors: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  // ===== Backfill =====
  async function fetchBackfill() {
    return apiRequest('/backfill');
  }

  async function loadBackfill() {
    setLoading(true);
    clearError();
    try {
      state.backfill = await fetchBackfill();
      renderBackfill();
    } catch (err) {
      showError(`Backfill: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  function renderBackfill() {
    const data = state.backfill;
    if (!data) {
      el.backfillContent.innerHTML = '<div class="empty-state">Loading</div>';
      return;
    }

    if (data.status === 'not_initialized') {
      el.backfillContent.innerHTML = '<div class="empty-state">Backfill not initialized</div>';
      return;
    }

    const t = data.tracker;
    if (!t) {
      el.backfillContent.innerHTML = '<div class="empty-state">No tracker data</div>';
      return;
    }

    const resultLedMap = {
      sent_batch: 'archive-dot-success',
      waiting: 'archive-dot-pending',
      settled: 'archive-dot-success',
      idle: 'archive-dot-absent',
      backoff: 'archive-dot-failed',
    };
    const dotClass = resultLedMap[t.last_run_result] || 'archive-dot-absent';
    const isPaused = t.consecutive_all_failed >= 2;

    function fmtTimestamp(ts) {
      if (!ts) return '--';
      if (ts._seconds) return formatTime(new Date(ts._seconds * 1000).toISOString());
      return formatTime(ts);
    }

    let html = '';

    if (isPaused) {
      html += `
        <div class="readout-strip" style="border-color: var(--red);">
          <div class="readout-cell" style="flex: 1;">
            <div class="readout-label">Status</div>
            <div class="readout-value readout-red">PAUSED</div>
          </div>
          <div class="readout-cell" style="flex: 2;">
            <div class="readout-label">Consecutive All-Failed</div>
            <div class="readout-value readout-red">${t.consecutive_all_failed}</div>
          </div>
        </div>
      `;
    }

    html += `
      <div class="readout-strip">
        <div class="readout-cell">
          <div class="readout-label">Run Result</div>
          <div class="readout-value"><span class="archive-dot ${dotClass}" style="display:inline-block;vertical-align:middle;margin-right:6px"></span>${escapeHtml(t.last_run_result || '--')}</div>
        </div>
        <div class="readout-cell">
          <div class="readout-label">Batch #</div>
          <div class="readout-value">${t.batch_number != null ? t.batch_number : '--'}</div>
        </div>
        <div class="readout-cell">
          <div class="readout-label">Batch Size</div>
          <div class="readout-value readout-cyan">${t.batch ? t.batch.length : 0}</div>
        </div>
        <div class="readout-cell">
          <div class="readout-label">Total Sent</div>
          <div class="readout-value">${formatNumber(t.total_sent)}</div>
        </div>
        <div class="readout-cell">
          <div class="readout-label">Total Complete</div>
          <div class="readout-value readout-green">${formatNumber(t.total_completed)}</div>
        </div>
        <div class="readout-cell">
          <div class="readout-label">Total Failed</div>
          <div class="readout-value ${t.total_failed > 0 ? 'readout-red' : ''}">${formatNumber(t.total_failed)}</div>
        </div>
      </div>
    `;

    html += `
      <div class="readout-strip">
        <div class="readout-cell">
          <div class="readout-label">Last Run</div>
          <div class="readout-value">${fmtTimestamp(t.last_run_at)}</div>
        </div>
        <div class="readout-cell">
          <div class="readout-label">Batch Started</div>
          <div class="readout-value">${fmtTimestamp(t.batch_started_at)}</div>
        </div>
        <div class="readout-cell">
          <div class="readout-label">Consecutive Failures</div>
          <div class="readout-value ${t.consecutive_all_failed > 0 ? 'readout-amber' : ''}">${t.consecutive_all_failed}</div>
        </div>
      </div>
    `;

    if (t.batch && t.batch.length > 0) {
      html += `
        <div class="card">
          <div class="card-header">
            <span class="card-title">Current Batch Items</span>
            <span class="card-count">${t.batch.length} items</span>
          </div>
          <div class="card-body card-body-flush">
            <table class="data-table">
              <thead><tr><th>URL</th><th class="td-right">Retries</th><th>Sent At</th></tr></thead>
              <tbody>
                ${t.batch.map(entry => `
                  <tr>
                    <td class="td-url">${escapeHtml(truncateUrl(entry.url, 60))}</td>
                    <td class="td-right">${entry.retry_count}</td>
                    <td>${fmtTimestamp(entry.sent_at)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    } else {
      html += `<div class="card"><div class="card-header"><span class="card-title">Current Batch</span></div><div class="card-body"><div class="empty-state">No active batch</div></div></div>`;
    }

    el.backfillContent.innerHTML = html;
  }

  // ===== Articles =====
  async function fetchArticles() {
    const params = new URLSearchParams();
    params.set('page', state.articles.pagination.page);
    params.set('limit', state.articles.pagination.limit);
    if (state.articles.filters.status) params.set('filter', state.articles.filters.status);
    if (state.articles.filters.search) params.set('search', state.articles.filters.search);
    return apiRequest(`/articles?${params}`);
  }

  async function loadArticles() {
    setLoading(true);
    clearError();
    try {
      const data = await fetchArticles();
      state.articles.items = data.articles || [];
      state.articles.pagination.total = data.total || 0;
      state.articles.pagination.hasMore = data.hasMore || false;
      renderArticleTable();
      renderArticlePagination();
    } catch (err) {
      showError(`Articles: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  function classificationBadgeHtml(classification) {
    return `<span class="status-badge status-${escapeHtml(classification)}"><span class="led"></span>${escapeHtml(classification)}</span>`;
  }

  function renderArchiveIndicators(archives) {
    if (!archives || archives.length === 0) return '<span style="color:var(--text-3)">--</span>';
    return `<div class="archive-indicators">${archives.map(a =>
      `<div class="archive-dot archive-dot-${escapeHtml(a.status)}" title="${escapeHtml(a.key)}: ${escapeHtml(a.status)}"></div>`
    ).join('')}</div>`;
  }

  function renderArticleTable() {
    if (state.articles.items.length === 0) {
      el.articleTableBody.innerHTML = `<tr><td colspan="5" class="empty-state">No articles found</td></tr>`;
      return;
    }

    el.articleTableBody.innerHTML = state.articles.items.map(article => {
      const display = article.title
        ? escapeHtml(truncateUrl(article.title, 60))
        : escapeHtml(truncateUrl(article.url, 60));
      return `
        <tr class="clickable" data-item-id="${escapeHtml(article.item_id)}">
          <td class="td-url" title="${escapeHtml(article.url)}">${display}</td>
          <td>${escapeHtml(article.domain)}</td>
          <td>${classificationBadgeHtml(article.archive_classification)}</td>
          <td>${renderArchiveIndicators(article.archives)}</td>
          <td>${formatTimeShort(article.created_at)}</td>
        </tr>
      `;
    }).join('');

    el.articleTableBody.querySelectorAll('tr.clickable').forEach(row => {
      row.addEventListener('click', () => loadArticleDetail(row.dataset.itemId));
    });
  }

  function renderArticlePagination() {
    const p = state.articles.pagination;
    const start = (p.page - 1) * p.limit + 1;
    const end = start + state.articles.items.length - 1;

    el.articlePaginationInfo.textContent = state.articles.items.length > 0
      ? `${start}-${end} of ${p.total}`
      : 'No results';

    el.articlePrevPage.disabled = p.page <= 1;
    el.articleNextPage.disabled = !p.hasMore;
  }

  async function fetchArticleDetail(itemId) {
    return apiRequest(`/articles/${encodeURIComponent(itemId)}`);
  }

  // ===== Article Detail with Pipeline + Archive Triggers =====
  async function loadArticleDetail(itemId) {
    // Show immediately from list data if available
    const listArticle = state.articles.items.find(a => a.item_id === itemId);
    const article = listArticle || { item_id: itemId, url: '', domain: '', created_at: '', archive_classification: 'unarchived', archives: [], has_canonical: false };
    state.articles.selectedArticle = article;
    showView('articleDetail');
    renderArticleDetailContent(article, null);

    // Fetch full detail from API (enriched with metadata)
    try {
      const detail = await fetchArticleDetail(itemId);
      state.articles.selectedArticle = detail;
      renderArticleDetailContent(detail, null);
    } catch {
      // Keep showing list data if detail fetch fails
    }

    // If article has a warg_request_id, fetch pipeline data
    const current = state.articles.selectedArticle;
    if (current.warg_request_id) {
      try {
        const pipelineData = await fetchRequestDetail(current.warg_request_id);
        renderArticleDetailContent(current, pipelineData);
      } catch {
        // Pipeline data optional — keep showing without it
      }
    }
  }

  function renderArticleDetailContent(article, pipelineData) {
    const events = pipelineData?.events || [];
    const hasPipeline = pipelineData !== null;
    const classification = article.archive_classification;
    const successCount = article.archives.filter(a => a.status === 'success').length;
    const totalArchives = article.archives.length;

    let html = '<div class="detail-grid">';

    // Pipeline visualization (if pipeline data available)
    if (hasPipeline && events.length > 0) {
      html += renderPipeline(events);
    }

    // Header
    html += `
      <div class="detail-header">
        <div class="detail-url">${escapeHtml(article.url)}</div>
        <div class="detail-meta">
          <div class="detail-meta-item">
            <span class="detail-meta-label">Item ID</span>
            <span class="detail-meta-value copyable" data-copy="${escapeHtml(article.item_id)}" title="Click to copy">
              ${escapeHtml(article.item_id)}
            </span>
          </div>
          ${article.title ? `
          <div class="detail-meta-item">
            <span class="detail-meta-label">Title</span>
            <span class="detail-meta-value">${escapeHtml(article.title)}</span>
          </div>
          ` : ''}
          <div class="detail-meta-item">
            <span class="detail-meta-label">Domain</span>
            <span class="detail-meta-value">${escapeHtml(article.domain)}</span>
          </div>
          <div class="detail-meta-item">
            <span class="detail-meta-label">Classification</span>
            ${classificationBadgeHtml(classification)}
          </div>
          ${article.warg_request_id ? `
          <div class="detail-meta-item">
            <span class="detail-meta-label">Request ID</span>
            <span class="detail-meta-value copyable" data-copy="${escapeHtml(article.warg_request_id)}" title="Click to copy">
              ${escapeHtml(article.warg_request_id)}
            </span>
          </div>
          ` : ''}
          <div class="detail-meta-item">
            <span class="detail-meta-label">Created</span>
            <span class="detail-meta-value">${formatTime(article.created_at)}</span>
          </div>
          ${article.firestore_status ? `
          <div class="detail-meta-item">
            <span class="detail-meta-label">Processing</span>
            <span class="detail-meta-value">${escapeHtml(article.firestore_status)}</span>
          </div>
          ` : ''}
          ${article.error ? `
          <div class="detail-meta-item">
            <span class="detail-meta-label">Error</span>
            <span class="detail-meta-value" style="color:var(--red)">${escapeHtml(article.error)}</span>
          </div>
          ` : ''}
        </div>
      </div>
    `;

    // Metadata panel (from ArticleDetail enrichment)
    const meta = article.metadata;
    if (meta && (meta.byline || meta.excerpt || meta.word_count || meta.site_name)) {
      html += `
        <div class="card">
          <div class="card-header"><span class="card-title">Metadata</span></div>
          <div class="card-body">
            <div class="detail-meta">
              ${meta.byline ? `<div class="detail-meta-item"><span class="detail-meta-label">Author</span><span class="detail-meta-value">${escapeHtml(meta.byline)}</span></div>` : ''}
              ${meta.site_name ? `<div class="detail-meta-item"><span class="detail-meta-label">Site</span><span class="detail-meta-value">${escapeHtml(meta.site_name)}</span></div>` : ''}
              ${meta.word_count ? `<div class="detail-meta-item"><span class="detail-meta-label">Words</span><span class="detail-meta-value">${meta.word_count.toLocaleString()}</span></div>` : ''}
              ${meta.published_time ? `<div class="detail-meta-item"><span class="detail-meta-label">Published</span><span class="detail-meta-value">${formatTime(meta.published_time)}</span></div>` : ''}
              ${meta.excerpt ? `<div class="detail-meta-item" style="grid-column:1/-1"><span class="detail-meta-label">Excerpt</span><span class="detail-meta-value">${escapeHtml(meta.excerpt)}</span></div>` : ''}
            </div>
          </div>
        </div>
      `;
    }

    // Action button: Archive / Re-archive All
    if (classification === 'unarchived') {
      html += `
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn-archive-full" data-action="archive-full" data-url="${escapeHtml(article.url)}" data-item-id="${escapeHtml(article.item_id)}">
            <svg viewBox="0 0 20 20" fill="none"><path d="M3 10l7-7 7 7M10 3v14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Archive This Article
          </button>
        </div>
      `;
    } else if (classification === 'incomplete' || classification === 'failed') {
      html += `
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn-rearchive-all" data-action="rearchive-all" data-url="${escapeHtml(article.url)}" data-item-id="${escapeHtml(article.item_id)}">
            Re-archive All
          </button>
        </div>
      `;
    }

    // Archives grid with per-archive action buttons
    html += `
      <div class="card">
        <div class="card-header">
          <span class="card-title">Archives</span>
          <span class="card-count">${successCount}/${totalArchives} available</span>
        </div>
        <div class="card-body">
          <div class="artifacts-grid">
            ${article.archives.map(a => {
              const dotClass = a.status === 'success' ? 'archive-dot-success' : a.status === 'pending' ? 'archive-dot-pending' : a.status === 'failed' ? 'archive-dot-failed' : 'archive-dot-absent';
              const step = ARCHIVE_KEY_TO_STEP[a.key];
              const canRearchive = (a.status === 'failed' || a.status === 'absent') && step;
              const canView = a.status === 'success';

              return `
                <div class="artifact-card">
                  <div class="artifact-kind">
                    <span class="archive-dot ${dotClass}"></span>
                    ${escapeHtml(a.key)}
                  </div>
                  <div class="artifact-meta">
                    <span>${escapeHtml(a.status)}</span>
                    ${a.compressed_size ? `<span>${formatBytes(a.compressed_size)}</span>` : ''}
                    ${a.created_at ? `<span>${formatTimeShort(a.created_at)}</span>` : ''}
                  </div>
                  <div class="artifact-actions">
                    ${canView ? `
                      <button class="artifact-action artifact-action-view"
                              data-action="view-archive"
                              data-item-id="${escapeHtml(article.item_id)}"
                              data-archive-key="${escapeHtml(a.key)}">
                        View
                      </button>
                    ` : ''}
                    ${canRearchive ? `
                      <button class="artifact-action artifact-action-archive"
                              data-action="rearchive-step"
                              data-url="${escapeHtml(article.url)}"
                              data-item-id="${escapeHtml(article.item_id)}"
                              data-step="${escapeHtml(step)}">
                        Re-archive
                      </button>
                    ` : ''}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;

    // Pipeline events timeline (if available)
    if (hasPipeline && events.length > 0) {
      html += `
        <div class="card">
          <div class="card-header">
            <span class="card-title">Pipeline Events</span>
            <span class="card-count">${events.length} events</span>
          </div>
          <div class="card-body">
            ${renderTimeline(events)}
          </div>
        </div>
      `;
    } else if (article.warg_request_id && !hasPipeline) {
      html += `
        <div class="card">
          <div class="card-header"><span class="card-title">Pipeline</span></div>
          <div class="card-body"><div class="empty-state">Loading pipeline data...</div></div>
        </div>
      `;
    }

    html += '</div>';

    el.articleDetailContent.innerHTML = html;

    // Wire copyable elements
    el.articleDetailContent.querySelectorAll('.copyable').forEach(copyEl => {
      copyEl.addEventListener('click', () => {
        navigator.clipboard.writeText(copyEl.dataset.copy).then(() => {
          showToast('Copied to clipboard');
        });
      });
    });

    // Wire archive action buttons
    el.articleDetailContent.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => handleArchiveAction(btn));
    });
  }

  // ===== Archive Actions from Article Detail =====
  async function handleArchiveAction(btn) {
    const action = btn.dataset.action;
    const url = btn.dataset.url;
    const itemId = btn.dataset.itemId;
    const step = btn.dataset.step;
    const archiveKey = btn.dataset.archiveKey;

    // View archive content (M3)
    if (action === 'view-archive' && itemId && archiveKey) {
      viewArchive(itemId, archiveKey);
      return;
    }

    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = 'Submitting...';

    try {
      const options = { request_id: itemId };
      if (action === 'rearchive-step' && step) {
        options.steps = [step];
      }

      const result = await submitArchive(url, options);
      const id = result.requestId || result.request_id || 'unknown';
      showToast(`Submitted: ${id.slice(0, 8)}`);

      // Poll article detail to refresh status
      setTimeout(() => {
        if (state.articles.selectedArticle?.item_id === itemId) {
          loadArticleDetail(itemId);
        }
      }, 5000);
    } catch (err) {
      showError(`Archive failed: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  // ===== Content Viewer =====
  async function viewArchive(itemId, archiveKey) {
    try {
      const data = await apiRequest(`/signed-url?itemId=${encodeURIComponent(itemId)}&archiveKey=${encodeURIComponent(archiveKey)}`);
      if (!data.url) throw new Error('No signed URL returned');
      showContentViewer(archiveKey, data.url);
    } catch (err) {
      showError(`Failed to load archive: ${err.message}`);
    }
  }

  function showContentViewer(archiveKey, url) {
    // Remove existing overlay if any
    const existing = document.querySelector('.content-viewer-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'content-viewer-overlay';

    let contentHtml;
    const htmlTypes = ['rendered', 'singlefile', 'monolith'];
    const textTypes = ['readability', 'markdown'];

    if (htmlTypes.includes(archiveKey)) {
      contentHtml = `<iframe class="content-viewer-frame" src="${escapeHtml(url)}" sandbox="allow-same-origin"></iframe>`;
    } else if (archiveKey === 'pdf') {
      contentHtml = `<iframe class="content-viewer-frame" src="${escapeHtml(url)}"></iframe>`;
    } else if (archiveKey === 'screenshot') {
      contentHtml = `<img class="content-viewer-image" src="${escapeHtml(url)}" alt="Screenshot">`;
    } else if (textTypes.includes(archiveKey)) {
      contentHtml = `<pre class="content-viewer-text">Loading...</pre>`;
    } else {
      contentHtml = `<div class="content-viewer-text">Unsupported archive type: ${escapeHtml(archiveKey)}</div>`;
    }

    overlay.innerHTML = `
      <div class="content-viewer-panel">
        <div class="content-viewer-header">
          <span class="content-viewer-title">${escapeHtml(archiveKey)}</span>
          <button class="content-viewer-close">&times;</button>
        </div>
        <div class="content-viewer-body">
          ${contentHtml}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Close handlers
    const close = () => overlay.remove();
    overlay.querySelector('.content-viewer-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    const escHandler = (e) => {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);

    // For text types, fetch and render content
    if (textTypes.includes(archiveKey)) {
      fetch(url)
        .then(r => r.text())
        .then(text => {
          const pre = overlay.querySelector('.content-viewer-text');
          if (pre) pre.textContent = text;
        })
        .catch(() => {
          const pre = overlay.querySelector('.content-viewer-text');
          if (pre) pre.textContent = 'Failed to load content';
        });
    }
  }

  // ===== Feed Polling =====
  async function pollFeed() {
    try {
      const data = await apiRequest('/requests?limit=20');
      const requests = data.requests || [];

      let newItems = 0;
      for (const req of requests) {
        if (!state.feed.knownIds.has(req.requestId)) {
          state.feed.knownIds.add(req.requestId);
          state.feed.items.unshift({ ...req, _new: true });
          newItems++;
        } else {
          const existing = state.feed.items.find(i => i.requestId === req.requestId);
          if (existing) {
            existing.stage = req.stage;
            existing.errorCount = req.errorCount;
          }
        }
      }

      if (state.feed.items.length > CONFIG.feedMaxItems) {
        const removed = state.feed.items.splice(CONFIG.feedMaxItems);
        for (const r of removed) {
          state.feed.knownIds.delete(r.requestId);
        }
      }

      if (newItems > 0) {
        state.feed.newCount += newItems;
        updateFeedBadge();
        if (state.currentView === 'feed') {
          state.feed.newCount = 0;
          updateFeedBadge();
          renderFeed();
        }
      } else if (state.currentView === 'feed') {
        renderFeed();
      }

      setTimeout(() => {
        for (const item of state.feed.items) {
          item._new = false;
        }
      }, 1200);

      el.connDot.classList.remove('disconnected');
      el.connLabel.textContent = 'Connected';
    } catch {
      el.connDot.classList.add('disconnected');
      el.connLabel.textContent = 'Disconnected';
    }
  }

  function startFeedPolling() {
    if (feedTimer) return;
    state.feed.polling = true;
    pollFeed();
    feedTimer = setInterval(pollFeed, CONFIG.feedPollInterval);
  }

  function stopFeedPolling() {
    if (feedTimer) {
      clearInterval(feedTimer);
      feedTimer = null;
    }
    state.feed.polling = false;
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

  // ===== UI State =====
  function setLoading(loading) {
    state.loading = loading;
    el.loadingOverlay.classList.toggle('hidden', !loading);
  }

  function showError(message) {
    state.error = message;
    el.errorMessage.textContent = message;
    el.errorBanner.className = 'toast toast-error';
  }

  function clearError() {
    state.error = null;
    el.errorBanner.className = 'toast hidden';
  }

  function showToast(message) {
    el.errorMessage.textContent = message;
    el.errorBanner.className = 'toast toast-success';

    setTimeout(() => {
      el.errorBanner.className = 'toast hidden';
    }, 2500);
  }

  // ===== Auto Refresh =====
  function startAutoRefresh() {
    stopAutoRefresh();
    if (state.settings.autoRefresh) {
      refreshTimer = setInterval(refreshCurrentView, state.settings.refreshInterval * 1000);
    }
  }

  function stopAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

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

    // Status filter
    el.statusFilter.addEventListener('change', (e) => {
      state.filters.status = e.target.value;
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
    document.addEventListener('keydown', (e) => {
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
        }
      }
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey && e.target.tagName !== 'INPUT') {
        refreshCurrentView();
      }
    });
  }

  function updateSortHeaders() {
    el.requestTable.querySelectorAll('th.sortable').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc');
      if (th.dataset.sort === state.sort.column) {
        th.classList.add(state.sort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
      }
    });
  }

  function sortAndRenderRequests() {
    const col = state.sort.column;
    const dir = state.sort.direction === 'asc' ? 1 : -1;

    state.requests.sort((a, b) => {
      let aVal, bVal;
      if (col === 'id') { aVal = a.requestId; bVal = b.requestId; }
      else if (col === 'url') { aVal = a.url || ''; bVal = b.url || ''; }
      else if (col === 'domain') { aVal = a.domain || getDomain(a.url); bVal = b.domain || getDomain(b.url); }
      else if (col === 'status') { aVal = a.stage || ''; bVal = b.stage || ''; }
      else if (col === 'created') { aVal = a.createdAt || ''; bVal = b.createdAt || ''; }
      else { aVal = ''; bVal = ''; }

      if (aVal < bVal) return -1 * dir;
      if (aVal > bVal) return 1 * dir;
      return 0;
    });

    renderRequestTable();
  }

  // ===== Initialize =====
  function init() {
    loadSettings();
    setupEventHandlers();
    startSystemClock();
    showView('overview');
    loadStats();
    startFeedPolling();

    if (state.settings.autoRefresh) {
      startAutoRefresh();
    }
  }

  init();
})();
