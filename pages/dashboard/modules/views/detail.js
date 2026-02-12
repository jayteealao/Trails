// @ts-check
import { el } from '../el.js';
import { state } from '../state.js';
import { fetchRequestDetail } from '../api.js';
import { escapeHtml, formatTime, formatBytes, getDomain } from '../utils.js';
import { statusBadgeHtml, renderPipeline, renderTimeline } from '../components.js';
import { showView } from '../router.js';
import { setLoading, showError, clearError, showToast } from '../ui.js';
import { CONFIG } from '../state.js';

const ACTIVE_POLL_MS = 3000;
const TERMINAL_STAGES = new Set(['done', 'failed']);
let detailPollTimer = null;
let eventSource = null;
let renderPending = false;

function isTerminal(stage) {
  return TERMINAL_STAGES.has(stage || '');
}

function stopDetailPoll() {
  if (detailPollTimer) {
    clearInterval(detailPollTimer);
    detailPollTimer = null;
  }
}

function startDetailPoll(requestId) {
  stopDetailPoll();
  detailPollTimer = setInterval(async () => {
    // Stop if user navigated away
    if (state.currentView !== 'detail' || state.selectedRequest?.requestId !== requestId) {
      stopDetailPoll();
      return;
    }
    try {
      state.selectedRequest = await fetchRequestDetail(requestId);
      renderDetailView();
      // Stop polling once terminal
      const stage = state.selectedRequest?.derived?.stage;
      if (isTerminal(stage)) stopDetailPoll();
    } catch {
      // Silently ignore poll errors
    }
  }, ACTIVE_POLL_MS);
}

/** Debounce renders to one per animation frame during SSE event bursts. */
function scheduleRender() {
  if (!renderPending) {
    renderPending = true;
    requestAnimationFrame(() => {
      renderPending = false;
      renderDetailView();
    });
  }
}

function disconnectStream() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

function connectStream(requestId) {
  disconnectStream();

  eventSource = new EventSource(`${CONFIG.apiBase}/stream/${requestId}`);

  eventSource.addEventListener('init', (e) => {
    const data = JSON.parse(e.data);
    // Reset events — SSE will re-deliver them via 'log' events
    state.selectedRequest = { ...state.selectedRequest, ...data, events: [] };
    scheduleRender();
  });

  eventSource.addEventListener('log', (e) => {
    const event = JSON.parse(e.data);
    if (!state.selectedRequest.events) state.selectedRequest.events = [];
    state.selectedRequest.events.push(event);
    scheduleRender();
  });

  eventSource.addEventListener('state', (e) => {
    const data = JSON.parse(e.data);
    state.selectedRequest.derived = data.derived;
    state.selectedRequest.artifacts = data.artifacts;
    scheduleRender();
  });

  eventSource.addEventListener('done', () => {
    disconnectStream();
  });

  eventSource.addEventListener('timeout', () => {
    // Server closed for resource management — reconnect SSE
    // EventSource auto-reconnects with Last-Event-ID
    disconnectStream();
    connectStream(requestId);
  });

  eventSource.addEventListener('stream-error', (e) => {
    const data = JSON.parse(e.data);
    showError(data.message || 'Stream error');
    disconnectStream();
  });

  eventSource.onerror = () => {
    // Fallback to adaptive polling on SSE failure
    disconnectStream();
    startDetailPoll(requestId);
  };
}

function stopDetailUpdates() {
  disconnectStream();
  stopDetailPoll();
}

export { stopDetailUpdates as stopDetailPoll };

export async function loadRequestDetail(requestId) {
  stopDetailUpdates();
  setLoading(true);
  clearError();
  try {
    state.selectedRequest = await fetchRequestDetail(requestId);
    showView('detail');
    renderDetailView();
    // Connect SSE stream if not terminal (falls back to polling on error)
    const stage = state.selectedRequest?.derived?.stage;
    if (!isTerminal(stage)) {
      connectStream(requestId);
    }
  } catch (err) {
    showError(`Detail: ${err.message}`);
  } finally {
    setLoading(false);
  }
}

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
