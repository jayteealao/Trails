// @ts-check
import { el } from '../el.js';
import { state, STAGE_COLORS } from '../state.js';
import { fetchStats } from '../api.js';
import { escapeHtml, truncateUrl, formatTimeShort } from '../utils.js';
import { setLoading, showError, clearError } from '../ui.js';

export async function loadStats() {
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

  // Import loadRequestDetail dynamically to avoid circular dependency
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
    row.addEventListener('click', () => {
      import('./detail.js').then(m => m.loadRequestDetail(row.dataset.id));
    });
  });
}
