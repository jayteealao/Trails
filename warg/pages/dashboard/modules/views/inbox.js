// @ts-check
import { el } from '../el.js';
import { state } from '../state.js';
import { fetchInbox, retryArticleMissing, retryArticleFull } from '../api.js';
import { escapeHtml, truncateUrl, formatTimeShort } from '../utils.js';
import { statusBadgeHtml, classificationBadgeHtml } from '../components.js';
import { setLoading, showError, clearError, showToast } from '../ui.js';

export async function loadInbox() {
  setLoading(true);
  clearError();
  try {
    state.inbox = await fetchInbox();
    renderInbox();
  } catch (err) {
    showError(`Inbox: ${err.message}`);
  } finally {
    setLoading(false);
  }
}

function renderRequestsTable(requests) {
  if (!requests || requests.length === 0) {
    return '<div class="empty-state">No failed requests</div>';
  }

  return `
    <table class="data-table">
      <thead><tr><th>ID</th><th>URL</th><th>Status</th><th>Error</th><th>Created</th></tr></thead>
      <tbody>
        ${requests.map((r) => `
          <tr class="clickable inbox-open-request" data-id="${escapeHtml(r.requestId)}">
            <td class="td-id">${escapeHtml(r.requestId.slice(0, 8))}</td>
            <td class="td-url">${escapeHtml(truncateUrl(r.url, 60))}</td>
            <td>${statusBadgeHtml(r.stage || 'failed')}</td>
            <td>${escapeHtml(r?.diagnostics?.errorCode || '--')}</td>
            <td>${formatTimeShort(r.createdAt)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderArticlesTable(articles) {
  if (!articles || articles.length === 0) {
    return '<div class="empty-state">No items</div>';
  }

  return `
    <table class="data-table">
      <thead><tr><th>Article</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>
        ${articles.map((a) => `
          <tr>
            <td class="td-url inbox-open-article clickable" data-id="${escapeHtml(a.item_id)}">
              ${escapeHtml(truncateUrl(a.title || a.url, 70))}
            </td>
            <td>${classificationBadgeHtml(a.archive_classification || 'incomplete')}</td>
            <td>
              <div class="inbox-action-row">
                <button class="artifact-action artifact-action-archive inbox-action" data-action="retry-missing" data-item-id="${escapeHtml(a.item_id)}">Retry Missing</button>
                <button class="artifact-action inbox-action" data-action="retry-full" data-item-id="${escapeHtml(a.item_id)}">Retry Full</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

export function renderInbox() {
  const inbox = state.inbox;
  if (!inbox) {
    el.inboxContent.innerHTML = '<div class="empty-state">Loading</div>';
    return;
  }

  const failedRequests = inbox.needsAttention?.failedRequests || [];
  const failedArticles = inbox.needsAttention?.failedArticles || [];
  const incompleteArticles = inbox.needsAttention?.incompleteArticles || [];
  const processingArticles = inbox.inProgress?.processingArticles || [];
  const recentArticles = inbox.recentlyCompleted?.articles || [];

  el.inboxContent.innerHTML = `
    <div class="readout-strip">
      <div class="readout-cell"><div class="readout-label">Needs Attention</div><div class="readout-value readout-red">${inbox.counts?.needsAttention ?? 0}</div></div>
      <div class="readout-cell"><div class="readout-label">In Progress</div><div class="readout-value readout-cyan">${inbox.counts?.inProgress ?? 0}</div></div>
      <div class="readout-cell"><div class="readout-label">Completed (24h)</div><div class="readout-value readout-green">${inbox.counts?.completedToday ?? 0}</div></div>
    </div>

    <div class="grid-2 inbox-grid">
      <div class="card">
        <div class="card-header"><span class="card-title">Failed Requests</span><span class="card-count">${failedRequests.length}</span></div>
        <div class="card-body card-body-flush">${renderRequestsTable(failedRequests)}</div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Failed Articles</span><span class="card-count">${failedArticles.length}</span></div>
        <div class="card-body card-body-flush">${renderArticlesTable(failedArticles)}</div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Incomplete Articles</span><span class="card-count">${incompleteArticles.length}</span></div>
        <div class="card-body card-body-flush">${renderArticlesTable(incompleteArticles)}</div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">In Progress</span><span class="card-count">${processingArticles.length}</span></div>
        <div class="card-body card-body-flush">${renderArticlesTable(processingArticles)}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><span class="card-title">Recently Completed</span><span class="card-count">${recentArticles.length}</span></div>
      <div class="card-body card-body-flush">${renderArticlesTable(recentArticles)}</div>
    </div>
  `;

  el.inboxContent.querySelectorAll('.inbox-open-request').forEach((row) => {
    row.addEventListener('click', () => {
      import('./detail.js').then((m) => m.loadRequestDetail(row.dataset.id));
    });
  });

  el.inboxContent.querySelectorAll('.inbox-open-article').forEach((cell) => {
    cell.addEventListener('click', () => {
      import('./articles.js').then((m) => m.loadArticleDetail(cell.dataset.id));
    });
  });

  el.inboxContent.querySelectorAll('.inbox-action').forEach((button) => {
    button.addEventListener('click', () => handleInboxAction(button));
  });
}

async function handleInboxAction(button) {
  const itemId = button.dataset.itemId;
  if (!itemId) return;
  const action = button.dataset.action;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Submitting...';
  try {
    const result = action === 'retry-full'
      ? await retryArticleFull(itemId)
      : await retryArticleMissing(itemId);
    if (!result.submitted) {
      showToast(result.reason || 'No action taken');
      return;
    }
    showToast(`Submitted ${result.requestId?.slice(0, 8) || itemId.slice(0, 8)}`);
    setTimeout(() => loadInbox(), 1500);
  } catch (err) {
    showError(`Inbox action failed: ${err.message}`);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}
