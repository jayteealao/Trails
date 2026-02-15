// @ts-check
import { el } from '../el.js';
import { state } from '../state.js';
import { fetchRequestDetail, submitArchive } from '../api.js';
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
  const diagnosis = req.derived?.diagnostics || {};
  const failedStep = deriveFailedStep(req);

  el.detailContent.innerHTML = `
    <div class="detail-grid">
      ${pipelineHtml}

      <div class="card diagnosis-card ${diagnosis.errorCode ? 'diagnosis-has-error' : ''}">
        <div class="card-header">
          <span class="card-title">Failure Diagnosis</span>
          ${diagnosis.errorCode ? `<span class="card-count">${escapeHtml(diagnosis.errorCode)}</span>` : ''}
        </div>
        <div class="card-body">
          <div class="detail-meta">
            <div class="detail-meta-item">
              <span class="detail-meta-label">Error</span>
              <span class="detail-meta-value">${escapeHtml(diagnosis.errorMessage || 'No active error')}</span>
            </div>
            <div class="detail-meta-item">
              <span class="detail-meta-label">Source</span>
              <span class="detail-meta-value">${escapeHtml(diagnosis.errorSource || '--')}</span>
            </div>
            <div class="detail-meta-item">
              <span class="detail-meta-label">Retryable</span>
              <span class="detail-meta-value">${diagnosis.retryable === false ? 'No' : 'Yes'}</span>
            </div>
            <div class="detail-meta-item">
              <span class="detail-meta-label">Suggested</span>
              <span class="detail-meta-value">${escapeHtml(diagnosis.recommendedAction || '--')}</span>
            </div>
            <div class="detail-meta-item">
              <span class="detail-meta-label">Trace ID</span>
              <span class="detail-meta-value">${escapeHtml(diagnosis.lastTraceId || '--')}</span>
            </div>
          </div>
          <div class="inbox-action-row" style="margin-top:10px">
            <button class="artifact-action inbox-action" data-detail-action="retry-step" data-request-id="${escapeHtml(req.requestId)}" ${failedStep ? `data-step="${escapeHtml(failedStep)}"` : 'disabled'}>Retry Failed Step</button>
            <button class="artifact-action artifact-action-archive inbox-action" data-detail-action="retry-missing" data-request-id="${escapeHtml(req.requestId)}">Retry Missing</button>
            <button class="artifact-action inbox-action" data-detail-action="retry-full" data-request-id="${escapeHtml(req.requestId)}">Retry Full</button>
          </div>
        </div>
      </div>

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

  el.detailContent.querySelectorAll('[data-detail-action]').forEach((button) => {
    button.addEventListener('click', () => handleDetailAction(button));
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

function deriveFailedStep(request) {
  const events = request.events || [];
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === 'step.failed' && event.data?.step) {
      return event.data.step;
    }
  }
  return null;
}

function deriveMissingSteps(request) {
  const artifacts = request.artifacts || [];
  const kinds = new Set(artifacts.map((a) => a.kind));
  const steps = [];

  if (!kinds.has('rendered.html')) steps.push('render');
  if (!kinds.has('singlefile.html')) steps.push('singlefile');
  if (!kinds.has('readability.json') || !kinds.has('readability.md')) steps.push('readability');
  if (!kinds.has('monolith.html')) steps.push('monolith');

  return [...new Set(steps)];
}

async function handleDetailAction(button) {
  const requestId = button.dataset.requestId;
  if (!requestId || !state.selectedRequest) return;

  const action = button.dataset.detailAction;
  const failedStep = button.dataset.step;
  const url = state.selectedRequest.url;
  if (!url) return;

  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Submitting...';

  try {
    let options = { request_id: requestId };
    if (action === 'retry-step' && failedStep) {
      options = { ...options, steps: [failedStep] };
    } else if (action === 'retry-missing') {
      const steps = deriveMissingSteps(state.selectedRequest);
      if (steps.length === 0) {
        showToast('No missing steps');
        return;
      }
      options = { ...options, steps };
    }

    const result = await submitArchive(url, options);
    const id = result.requestId || result.request_id || requestId;
    showToast(`Submitted: ${id.slice(0, 8)}`);
    setTimeout(() => loadRequestDetail(requestId), 1200);
  } catch (err) {
    showError(`Retry failed: ${err.message}`);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}
