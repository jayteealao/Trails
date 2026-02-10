// Warg Observatory - Industrial Monitor Dashboard

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

  // Stage colors for segmented bar
  const STAGE_COLORS = {
    done: 'var(--stage-done)',
    failed: 'var(--stage-failed)',
    rendering: 'var(--stage-rendering)',
    deriving: 'var(--stage-deriving)',
    persisting: 'var(--stage-persisting)',
    queued: 'var(--stage-queued)',
  };

  // Pipeline step definitions (maps to EventSource in logging.ts)
  const PIPELINE_STEPS = [
    { id: 'render', label: 'Render', source: 'renderer' },
    { id: 'singlefile', label: 'Singlefile', source: 'singlefile' },
    { id: 'readability', label: 'Readability', source: 'readability' },
    { id: 'monolith', label: 'Monolith', source: 'monolith' },
    { id: 'persist', label: 'Persist', source: 'gcs' },
  ];

  // ===== State =====
  const state = {
    currentView: 'overview',
    previousView: null,
    requests: [],
    selectedRequest: null,
    stats: null,
    infra: null,
    errors: null,
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
    // Feed state
    feed: {
      items: [],
      knownIds: new Set(),
      newCount: 0,
      polling: false,
    },
    // Sort state for requests table
    sort: {
      column: 'created',
      direction: 'desc',
    },
  };

  let refreshTimer = null;
  let feedTimer = null;
  let clockTimer = null;

  // ===== DOM Elements =====
  const el = {
    // Views
    overviewView: document.getElementById('overviewView'),
    requestsView: document.getElementById('requestsView'),
    detailView: document.getElementById('detailView'),
    infraView: document.getElementById('infraView'),
    feedView: document.getElementById('feedView'),
    errorsView: document.getElementById('errorsView'),
    // Nav
    navItems: document.querySelectorAll('.nav-item[data-view]'),
    feedBadge: document.getElementById('feedBadge'),
    // System bar
    connLed: document.getElementById('connLed'),
    refreshLed: document.getElementById('refreshLed'),
    systemClock: document.getElementById('systemClock'),
    // Archive form
    archiveInput: document.getElementById('archiveInput'),
    archiveBtn: document.getElementById('archiveBtn'),
    archiveStatus: document.getElementById('archiveStatus'),
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
    refreshStatsBtn: document.getElementById('refreshStatsBtn'),
    // Infra
    workersPanel: document.getElementById('workersPanel'),
    workflowsPanel: document.getElementById('workflowsPanel'),
    storagePanel: document.getElementById('storagePanel'),
    refreshInfraBtn: document.getElementById('refreshInfraBtn'),
    // Requests
    requestTableBody: document.getElementById('requestTableBody'),
    requestTable: document.getElementById('requestTable'),
    domainFilter: document.getElementById('domainFilter'),
    statusFilter: document.getElementById('statusFilter'),
    prevPage: document.getElementById('prevPage'),
    nextPage: document.getElementById('nextPage'),
    paginationInfo: document.getElementById('paginationInfo'),
    refreshBtn: document.getElementById('refreshBtn'),
    autoRefreshToggle: document.getElementById('autoRefreshToggle'),
    backBtn: document.getElementById('backBtn'),
    // Detail
    detailContent: document.getElementById('detailContent'),
    // Feed
    feedContainer: document.getElementById('feedContainer'),
    feedCount: document.getElementById('feedCount'),
    feedLed: document.getElementById('feedLed'),
    // Errors
    errorsContent: document.getElementById('errorsContent'),
    refreshErrorsBtn: document.getElementById('refreshErrorsBtn'),
    // Loading & Error
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

  async function submitArchive(url) {
    return apiRequest('/begin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
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
      el.systemClock.textContent = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    update();
    clockTimer = setInterval(update, 1000);
  }

  // ===== Status Badge Helper =====
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

    // Color stuck value
    const stuckEl = el.statStuck;
    if (s.stuckCount > 0) {
      stuckEl.classList.add('readout-amber');
    } else {
      stuckEl.classList.remove('readout-amber');
    }

    renderSegmentedBar(s.byStage, s.total);
    renderTopDomains(s.topDomains);
    renderRecentFailures(s.recentFailures);
  }

  function renderSegmentedBar(byStage, total) {
    if (!byStage || total === 0) {
      el.segmentedBar.innerHTML = '';
      el.segmentedLegend.innerHTML = '<span class="legend-item" style="color:var(--text-muted)">No data</span>';
      return;
    }

    const stages = Object.entries(byStage).sort((a, b) => b[1] - a[1]);

    el.segmentedBar.innerHTML = stages.map(([stage, count]) => {
      const pct = (count / total * 100);
      const color = STAGE_COLORS[stage] || 'var(--text-muted)';
      return `<div class="segmented-bar-segment" style="width:${pct}%;background:${color}" title="${stage}: ${count} (${pct.toFixed(1)}%)"></div>`;
    }).join('');

    el.segmentedLegend.innerHTML = stages.map(([stage, count]) => {
      const color = STAGE_COLORS[stage] || 'var(--text-muted)';
      const pct = (count / total * 100).toFixed(1);
      return `<span class="legend-item"><span class="legend-swatch" style="background:${color}"></span>${stage} ${count} (${pct}%)</span>`;
    }).join('');
  }

  function renderTopDomains(domains) {
    if (!domains || domains.length === 0) {
      el.topDomains.innerHTML = '<div class="empty-state"><div class="empty-state-text">No domains</div></div>';
      return;
    }

    el.topDomains.innerHTML = `
      <table class="data-table domain-table">
        <thead><tr><th>Domain</th><th style="text-align:right">Count</th></tr></thead>
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
      el.recentFailures.innerHTML = '<div class="empty-state"><div class="empty-state-text">No failures</div></div>';
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
      el.workersPanel.innerHTML = '<div class="empty-state"><div class="empty-state-text">No worker data</div></div>';
      return;
    }

    el.workersPanel.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Worker</th>
            <th style="text-align:right">Requests</th>
            <th style="text-align:right">Error Rate</th>
            <th style="text-align:right">CPU p50</th>
            <th style="text-align:right">CPU p99</th>
            <th>Health</th>
          </tr>
        </thead>
        <tbody>
          ${workers.map(w => {
            const errorRate = w.requests > 0 ? (w.errors / w.requests * 100).toFixed(1) : '0.0';
            const healthClass = parseFloat(errorRate) > 5 ? 'metric-bad' : parseFloat(errorRate) > 1 ? 'metric-warn' : 'metric-ok';
            const healthLed = parseFloat(errorRate) > 5 ? 'led-red' : parseFloat(errorRate) > 1 ? 'led-amber' : 'led-on';
            return `
              <tr>
                <td>${escapeHtml(w.scriptName)}</td>
                <td class="td-right">${formatNumber(w.requests)}</td>
                <td class="td-right ${healthClass}">${errorRate}%</td>
                <td class="td-right">${w.cpuP50 != null ? w.cpuP50 + 'ms' : '--'}</td>
                <td class="td-right">${w.cpuP99 != null ? w.cpuP99 + 'ms' : '--'}</td>
                <td><span class="led ${healthLed}"></span></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  function renderWorkflowsPanel(workflows) {
    if (!workflows) {
      el.workflowsPanel.innerHTML = '<div class="empty-state"><div class="empty-state-text">No workflow data</div></div>';
      return;
    }

    const statuses = workflows.statusCounts || {};
    const entries = Object.entries(statuses);

    if (entries.length === 0) {
      el.workflowsPanel.innerHTML = '<div class="empty-state"><div class="empty-state-text">No workflow instances</div></div>';
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
      el.storagePanel.innerHTML = '<div class="empty-state"><div class="empty-state-text">No storage data</div></div>';
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
      el.requestTableBody.innerHTML = `
        <tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text-muted)">No requests found</td></tr>
      `;
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
          <td>${errorCount > 0 ? `<span class="error-count">${errorCount}</span>` : '<span style="color:var(--text-dim)">0</span>'}</td>
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

    // Pipeline visualizer
    const pipelineHtml = renderPipeline(events);

    el.detailContent.innerHTML = `
      ${pipelineHtml}

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
            ${statusBadgeHtml(stage)}
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

    el.detailContent.querySelectorAll('.copyable').forEach(copyEl => {
      copyEl.addEventListener('click', () => {
        navigator.clipboard.writeText(copyEl.dataset.copy).then(() => {
          showToast('Copied to clipboard');
        });
      });
    });
  }

  // ===== Render: Pipeline Visualizer =====
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
      const ledClass = `pipeline-led-${s.status}`;
      const stepClass = `step-${s.status}`;

      parts.push(`
        <div class="pipeline-step ${stepClass}">
          <div class="pipeline-led ${ledClass}"></div>
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
      return '<div class="empty-state"><div class="empty-state-text">No events recorded</div></div>';
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
      return '<div class="empty-state"><div class="empty-state-text">No artifacts generated</div></div>';
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
      el.feedContainer.innerHTML = '<div class="empty-state"><div class="empty-state-text">Waiting for requests</div></div>';
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

  // ===== Render: Errors View =====
  function renderErrors() {
    const data = state.errors;
    if (!data) {
      el.errorsContent.innerHTML = '<div class="empty-state"><div class="empty-state-text">Loading</div></div>';
      return;
    }

    const { stats, failedRequests, errorsBySource, errorPatterns } = data;

    // Error readout strip
    const total = stats?.total || 0;
    const failed = failedRequests?.length || 0;
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

    // Errors by source
    const sourceEntries = Object.entries(errorsBySource).sort((a, b) => b[1] - a[1]);
    const maxSourceCount = sourceEntries.length > 0 ? sourceEntries[0][1] : 1;

    if (sourceEntries.length > 0) {
      html += `
        <div class="section">
          <div class="section-header">
            <span class="section-title">Errors by Source</span>
          </div>
          <div class="section-body" style="padding: 0;">
            <table class="data-table">
              <thead><tr><th>Source</th><th style="text-align:right">Count</th><th style="min-width:120px">Frequency</th></tr></thead>
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

    // Error patterns
    if (errorPatterns.length > 0) {
      html += `
        <div class="section">
          <div class="section-header">
            <span class="section-title">Error Patterns</span>
          </div>
          <div class="section-body" style="padding: 0;">
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

    // Affected requests table
    if (failedRequests && failedRequests.length > 0) {
      html += `
        <div class="section">
          <div class="section-header">
            <span class="section-title">Failed Requests</span>
            <span class="section-count">${failedRequests.length}</span>
          </div>
          <div class="section-body" style="padding: 0;">
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

    el.navItems.forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewName);
    });

    // Reset feed badge when viewing feed
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
      // Fetch stats and failed requests in parallel
      const [stats, failedData] = await Promise.all([
        fetchStats(),
        apiRequest('/requests?status=failed&limit=50'),
      ]);

      const failedRequests = failedData.requests || [];

      // Fetch detail for up to 10 recent failures to extract error events
      const detailPromises = failedRequests.slice(0, 10).map(r =>
        fetchRequestDetail(r.requestId).catch(() => null)
      );
      const details = await Promise.all(detailPromises);

      // Aggregate errors by source
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
          // Update existing item's stage
          const existing = state.feed.items.find(i => i.requestId === req.requestId);
          if (existing) {
            existing.stage = req.stage;
            existing.errorCount = req.errorCount;
          }
        }
      }

      // Trim to max
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
        // Still update to reflect status changes
        renderFeed();
      }

      // Clear _new flag after render
      setTimeout(() => {
        for (const item of state.feed.items) {
          item._new = false;
        }
      }, 1200);

      // Update connection LED
      el.connLed.className = 'led led-on';
    } catch {
      el.connLed.className = 'led led-red';
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

  // ===== Archive Submission =====
  async function handleArchiveSubmit() {
    const url = el.archiveInput.value.trim();
    if (!url) return;

    // Basic URL validation
    try {
      new URL(url);
    } catch {
      el.archiveStatus.textContent = 'ERR: invalid URL';
      el.archiveStatus.className = 'archive-status archive-err';
      return;
    }

    el.archiveBtn.disabled = true;
    el.archiveStatus.textContent = 'SUBMITTING...';
    el.archiveStatus.className = 'archive-status';

    try {
      const result = await submitArchive(url);
      const id = result.requestId || result.request_id || 'unknown';
      el.archiveStatus.textContent = `OK: ${id.slice(0, 8)}`;
      el.archiveStatus.className = 'archive-status archive-ok';
      el.archiveInput.value = '';

      // Auto-navigate to detail after brief delay
      setTimeout(() => {
        loadRequestDetail(id);
        el.archiveStatus.textContent = '';
        el.archiveStatus.className = 'archive-status';
      }, 800);
    } catch (err) {
      el.archiveStatus.textContent = `ERR: ${err.message}`;
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
    el.errorBanner.classList.remove('hidden');
    el.errorBanner.style.background = '';
    el.errorBanner.style.borderColor = '';
    el.errorBanner.style.color = '';
  }

  function clearError() {
    state.error = null;
    el.errorBanner.classList.add('hidden');
  }

  function showToast(message) {
    el.errorMessage.textContent = message;
    el.errorBanner.style.background = 'var(--green-dim)';
    el.errorBanner.style.borderColor = 'var(--green)';
    el.errorBanner.style.color = 'var(--green)';
    el.errorBanner.classList.remove('hidden');

    setTimeout(() => {
      el.errorBanner.classList.add('hidden');
      el.errorBanner.style.background = '';
      el.errorBanner.style.borderColor = '';
      el.errorBanner.style.color = '';
    }, 2000);
  }

  // ===== Auto Refresh =====
  function startAutoRefresh() {
    stopAutoRefresh();
    if (state.settings.autoRefresh) {
      refreshTimer = setInterval(refreshCurrentView, state.settings.refreshInterval * 1000);
      el.refreshLed.className = 'led led-on';
    }
  }

  function stopAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    el.refreshLed.className = 'led led-off';
  }

  function refreshCurrentView() {
    if (state.currentView === 'overview') loadStats();
    else if (state.currentView === 'requests') loadRequests();
    else if (state.currentView === 'infra') loadInfra();
    else if (state.currentView === 'errors') loadErrors();
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
      });
    });

    // Refresh buttons
    el.refreshBtn.addEventListener('click', () => {
      if (state.currentView === 'requests') loadRequests();
      else if (state.currentView === 'detail' && state.selectedRequest) {
        loadRequestDetail(state.selectedRequest.requestId);
      }
    });

    el.refreshStatsBtn.addEventListener('click', () => loadStats());
    el.refreshInfraBtn.addEventListener('click', () => loadInfra());
    el.refreshErrorsBtn.addEventListener('click', () => loadErrors());

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

    // Start on overview
    showView('overview');
    loadStats();

    // Start feed polling (always runs in background)
    startFeedPolling();

    if (state.settings.autoRefresh) {
      startAutoRefresh();
    }
  }

  init();
})();
