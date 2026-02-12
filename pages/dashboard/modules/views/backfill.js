// @ts-check
import { el } from '../el.js';
import { state } from '../state.js';
import { fetchBackfill } from '../api.js';
import { escapeHtml, truncateUrl, formatTime, formatNumber } from '../utils.js';
import { setLoading, showError, clearError } from '../ui.js';

export async function loadBackfill() {
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

function fmtTimestamp(ts) {
  if (!ts) return '--';
  if (ts._seconds) return formatTime(new Date(ts._seconds * 1000).toISOString());
  return formatTime(ts);
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
