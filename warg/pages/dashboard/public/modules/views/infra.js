// @ts-check
import { el } from '../el.js';
import { state } from '../state.js';
import { fetchInfra } from '../api.js';
import { escapeHtml, formatNumber, formatBytes } from '../utils.js';
import { setLoading, showError, clearError } from '../ui.js';

export async function loadInfra() {
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
