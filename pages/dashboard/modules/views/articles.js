// @ts-check
import { el } from '../el.js';
import { state, ARCHIVE_KEY_TO_STEP } from '../state.js';
import {
  fetchArticles,
  fetchArticleDetail,
  fetchRequestDetail,
  submitArchive,
  buildArchiveContentUrl,
  retryArticleMissing,
  retryArticleFull
} from '../api.js';
import { escapeHtml, truncateUrl, formatTimeShort, formatTime, formatBytes } from '../utils.js';
import { classificationBadgeHtml, renderArchiveIndicators, renderPipeline, renderTimeline } from '../components.js';
import { showView } from '../router.js';
import { setLoading, showError, clearError, showToast } from '../ui.js';

export async function loadArticles() {
  setLoading(true);
  clearError();
  try {
    const data = await fetchArticles(state.articles.filters, state.articles.pagination);
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

export function renderArticleTable() {
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
        <td>
          ${renderArchiveIndicators(article.archives)}
          <div class="inbox-action-row" style="margin-top:6px">
            <button class="artifact-action row-action-btn" data-row-action="open-best" data-item-id="${escapeHtml(article.item_id)}">Open Best</button>
            <button class="artifact-action artifact-action-archive row-action-btn" data-row-action="retry-missing" data-item-id="${escapeHtml(article.item_id)}">Retry Missing</button>
            <button class="artifact-action row-action-btn" data-row-action="retry-full" data-item-id="${escapeHtml(article.item_id)}">Retry Full</button>
          </div>
        </td>
        <td>${formatTimeShort(article.created_at)}</td>
      </tr>
    `;
  }).join('');

  el.articleTableBody.querySelectorAll('tr.clickable').forEach(row => {
    row.addEventListener('click', () => loadArticleDetail(row.dataset.itemId));
  });

  el.articleTableBody.querySelectorAll('.row-action-btn').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      handleRowAction(button);
    });
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

// ===== Article Detail =====

export async function loadArticleDetail(itemId) {
  // Show immediately from list data if available
  const listArticle = state.articles.items.find(a => a.item_id === itemId);
  const article = listArticle || { item_id: itemId, url: '', domain: '', created_at: '', archive_classification: 'unarchived', archives: [], has_canonical: false };
  state.articles.selectedArticle = article;
  showView('articleDetail');
  renderArticleDetailContent(article, null);

  // Fetch full detail from API (enriched with metadata)
  try {
    const detail = await fetchArticleDetail(itemId);
    if (state.articles.selectedArticle?.item_id !== itemId) return; // stale
    state.articles.selectedArticle = detail;
    renderArticleDetailContent(detail, null);
  } catch {
    // Keep showing list data if detail fetch fails
  }

  if (state.articles.selectedArticle?.item_id !== itemId) return; // stale

  // If article has a warg_request_id, fetch pipeline data
  const current = state.articles.selectedArticle;
  if (current.warg_request_id) {
    try {
      const pipelineData = await fetchRequestDetail(current.warg_request_id);
      if (state.articles.selectedArticle?.item_id !== itemId) return; // stale
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
  const health = buildArticleHealth(article);

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

  html += `
    <div class="card">
      <div class="card-header"><span class="card-title">Article Health</span></div>
      <div class="card-body">
        <div class="detail-meta">
          <div class="detail-meta-item">
            <span class="detail-meta-label">Completeness</span>
            <span class="detail-meta-value">${health.completenessScore}%</span>
          </div>
          <div class="detail-meta-item">
            <span class="detail-meta-label">Best Archive</span>
            <span class="detail-meta-value">${escapeHtml(health.bestAvailableArchive || '--')}</span>
          </div>
          <div class="detail-meta-item">
            <span class="detail-meta-label">Missing Core</span>
            <span class="detail-meta-value">${escapeHtml(health.missingCore.join(', ') || 'None')}</span>
          </div>
          <div class="detail-meta-item">
            <span class="detail-meta-label">Failed Archives</span>
            <span class="detail-meta-value">${escapeHtml(health.failedArchives.join(', ') || 'None')}</span>
          </div>
          <div class="detail-meta-item">
            <span class="detail-meta-label">Suggested Action</span>
            <span class="detail-meta-value">${escapeHtml(health.recommendedAction)}</span>
          </div>
        </div>
      </div>
    </div>
  `;

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
                    <button class="artifact-action artifact-action-download"
                            data-action="download-archive"
                            data-item-id="${escapeHtml(article.item_id)}"
                            data-archive-key="${escapeHtml(a.key)}">
                      Download
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

function getBestArchiveKey(archives) {
  const byKey = new Map((archives || []).map((a) => [a.key, a]));
  const priority = ['markdown', 'readability', 'singlefile', 'rendered'];
  for (const key of priority) {
    const entry = byKey.get(key);
    if (entry?.status === 'success') return key;
  }
  return null;
}

function buildArticleHealth(article) {
  const archives = article.archives || [];
  const core = ['rendered', 'readability', 'markdown', 'singlefile'];
  const map = new Map(archives.map((a) => [a.key, a.status]));
  const missingCore = core.filter((k) => map.get(k) !== 'success');
  const failedArchives = archives.filter((a) => a.status === 'failed').map((a) => a.key);
  const coreSuccess = core.filter((k) => map.get(k) === 'success').length;
  const completenessScore = Math.round((coreSuccess / core.length) * 100);
  const bestAvailableArchive = getBestArchiveKey(archives);
  const recommendedAction = missingCore.length > 0 || failedArchives.length > 0
    ? 'retry_missing'
    : 'none';

  return {
    completenessScore,
    missingCore,
    failedArchives,
    bestAvailableArchive,
    recommendedAction,
  };
}

async function handleRowAction(button) {
  const itemId = button.dataset.itemId;
  if (!itemId) return;
  const action = button.dataset.rowAction;

  const article = state.articles.items.find((a) => a.item_id === itemId);
  if (!article) return;

  const original = button.textContent;
  button.disabled = true;
  button.textContent = '...';
  try {
    if (action === 'open-best') {
      const archiveKey = getBestArchiveKey(article.archives || []);
      if (!archiveKey) {
        showToast('No readable archive available');
      } else {
        await viewArchive(itemId, archiveKey);
      }
      return;
    }

    const result = action === 'retry-full'
      ? await retryArticleFull(itemId)
      : await retryArticleMissing(itemId);

    if (!result.submitted) {
      showToast(result.reason || 'No action taken');
      return;
    }
    showToast(`Submitted: ${(result.requestId || itemId).slice(0, 8)}`);
    setTimeout(() => loadArticles(), 1000);
  } catch (err) {
    showError(`Action failed: ${err.message}`);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

// ===== Archive Actions =====

async function handleArchiveAction(btn) {
  const action = btn.dataset.action;
  const url = btn.dataset.url;
  const itemId = btn.dataset.itemId;
  const step = btn.dataset.step;
  const archiveKey = btn.dataset.archiveKey;

  // View archive content
  if (action === 'view-archive' && itemId && archiveKey) {
    viewArchive(itemId, archiveKey);
    return;
  }

  // Download archive
  if (action === 'download-archive' && itemId && archiveKey) {
    downloadArchive(itemId, archiveKey, btn);
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
    const url = buildArchiveContentUrl(itemId, archiveKey);
    showContentViewer(archiveKey, url);
  } catch (err) {
    showError(`Failed to load archive: ${err.message}`);
  }
}

async function downloadArchive(itemId, archiveKey, btn) {
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Preparing...';
  try {
    const a = document.createElement('a');
    a.href = buildArchiveContentUrl(itemId, archiveKey, { download: true });
    a.download = `${itemId}-${archiveKey}`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    showError(`Download failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
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
    contentHtml = `<iframe class="content-viewer-frame" src="${escapeHtml(url)}" sandbox="allow-same-origin allow-scripts"></iframe>`;
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
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}`);
        }
        return r.text();
      })
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
