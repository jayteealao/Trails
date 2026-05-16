// @ts-check
import { el } from '../el.js';
import { state, CONFIG } from '../state.js';
import { fetchRequests } from '../api.js';
import { escapeHtml, truncateUrl, formatTimeShort, getDomain, dateRangeToParams } from '../utils.js';
import { statusBadgeHtml } from '../components.js';
import { setLoading, showError, clearError } from '../ui.js';

export async function loadRequests() {
  setLoading(true);
  clearError();
  try {
    const dateParams = dateRangeToParams(state.filters.dateRange);
    const filters = { ...state.filters, ...dateParams };
    const data = await fetchRequests(filters, state.pagination);
    state.requests = data.requests || [];
    state.selectedRowIndex = -1;
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

export function renderRequestTable() {
  if (state.requests.length === 0) {
    el.requestTableBody.innerHTML = `<tr><td colspan="6" class="empty-state">No requests found</td></tr>`;
    return;
  }

  el.requestTableBody.innerHTML = state.requests.map(req => {
    const errorCount = req.errorCount || 0;
    const stage = req.stage || 'queued';
    const domain = req.domain || getDomain(req.url);
    const errorLabel = req.diagnostics?.errorCode ? ` (${req.diagnostics.errorCode})` : '';
    const fallbackBadge = req.diagnostics?.renderFallbackUsed
      ? '<span class="render-fallback-chip" title="Render used Hyperrender fallback">HYPER</span>'
      : '';

    return `
      <tr class="clickable" data-id="${escapeHtml(req.requestId)}">
        <td class="td-id">${escapeHtml(req.requestId.slice(0, 8))}</td>
        <td class="td-url">${escapeHtml(truncateUrl(req.url, 60))}</td>
        <td>${escapeHtml(domain)}</td>
        <td>${statusBadgeHtml(stage)}${fallbackBadge}</td>
        <td>${errorCount > 0 ? `<span class="error-count">${errorCount}${escapeHtml(errorLabel)}</span>` : '<span style="color:var(--text-3)">0</span>'}</td>
        <td>${formatTimeShort(req.createdAt)}</td>
      </tr>
    `;
  }).join('');

  el.requestTableBody.querySelectorAll('tr.clickable').forEach(row => {
    row.addEventListener('click', () => {
      import('./detail.js').then(m => m.loadRequestDetail(row.dataset.id));
    });
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

export function updateSortHeaders() {
  el.requestTable.querySelectorAll('th.sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === state.sort.column) {
      th.classList.add(state.sort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
}

export function sortAndRenderRequests() {
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
