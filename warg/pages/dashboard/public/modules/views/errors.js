// @ts-check
import { el } from '../el.js';
import { state } from '../state.js';
import { fetchStats, fetchRequests, fetchBatch } from '../api.js';
import { escapeHtml, truncateUrl, formatTimeShort } from '../utils.js';
import { setLoading, showError, clearError } from '../ui.js';

export async function loadErrors() {
  setLoading(true);
  clearError();
  try {
    const [stats, failedData] = await Promise.all([
      fetchStats(),
      fetchRequests({ domain: '', status: 'failed' }, { offset: 0 }),
    ]);

    const failedRequests = failedData.requests || [];

    // Batch fetch summaries from D1 index (single HTTP call instead of N)
    const ids = failedRequests.slice(0, 50).map(r => r.requestId);
    let batchDetails = [];
    if (ids.length > 0) {
      try {
        const batchResult = await fetchBatch(ids);
        batchDetails = batchResult.requests || [];
      } catch {
        // Fall back to showing failed requests without enrichment
      }
    }

    // Build error-by-source from D1 index data (stage + errorCount)
    const errorsBySource = {};
    for (const detail of batchDetails) {
      if (detail.errorCount > 0) {
        const src = detail.stage || 'unknown';
        errorsBySource[src] = (errorsBySource[src] || 0) + detail.errorCount;
      }
    }

    // Group by domain as error pattern proxy (D1 doesn't have event-level messages)
    const patternMap = {};
    for (const detail of batchDetails) {
      if (detail.errorCount > 0) {
        const key = detail.domain || 'unknown';
        if (!patternMap[key]) {
          patternMap[key] = { message: `Failures on ${key}`, count: 0, requestIds: [] };
        }
        patternMap[key].count += detail.errorCount;
        patternMap[key].requestIds.push(detail.requestId);
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
    row.addEventListener('click', () => {
      import('./detail.js').then(m => m.loadRequestDetail(row.dataset.id));
    });
  });
}
