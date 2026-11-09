// @ts-check
import { PIPELINE_STEPS } from './state.js';
import { escapeHtml, formatDuration, formatTime } from './utils.js';

export function statusBadgeHtml(stage) {
  return `<span class="status-badge status-${escapeHtml(stage)}"><span class="led"></span>${escapeHtml(stage)}</span>`;
}

export function classificationBadgeHtml(classification) {
  return `<span class="status-badge status-${escapeHtml(classification)}"><span class="led"></span>${escapeHtml(classification)}</span>`;
}

export function renderArchiveIndicators(archives) {
  if (!archives || archives.length === 0) return '<span style="color:var(--text-3)">--</span>';
  return `<div class="archive-indicators">${archives.map(a =>
    `<div class="archive-dot archive-dot-${escapeHtml(a.status)}" title="${escapeHtml(a.key)}: ${escapeHtml(a.status)}"></div>`
  ).join('')}</div>`;
}

// ===== Pipeline Visualizer =====

const STEP_ID_SET = new Set(PIPELINE_STEPS.map((step) => step.id));
const STEP_BY_SOURCE = new Map(PIPELINE_STEPS.map((step) => [step.source, step.id]));

const STEP_BY_EVENT_STEP = new Map([
  ['render', ['render']],
  ['singlefile', ['singlefile']],
  ['readability', ['readability']],
  ['monolith', ['monolith']],
  ['persist', ['persist']],
  ['derivatives', ['readability', 'monolith']],
]);

function hasStepType(type) {
  return typeof type === 'string' && type.startsWith('step.');
}

function hasPersistType(type) {
  return typeof type === 'string' && type.startsWith('persist.');
}

function isFiniteDuration(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function extractStepName(event) {
  const step = event?.data?.step;
  return typeof step === 'string' ? step.toLowerCase() : undefined;
}

function resolvePipelineTargets(event) {
  const type = event?.type;

  if (hasPersistType(type)) {
    return ['persist'];
  }

  const stepName = extractStepName(event);
  if (hasStepType(type) && stepName) {
    const mappedSteps = STEP_BY_EVENT_STEP.get(stepName);
    if (mappedSteps) return mappedSteps;
    if (STEP_ID_SET.has(stepName)) return [stepName];
  }

  const source = event?.source;
  const legacyStep = typeof source === 'string' ? STEP_BY_SOURCE.get(source) : undefined;
  return legacyStep ? [legacyStep] : [];
}

function updateElapsed(stepState, event) {
  const duration = event?.data?.duration_ms;
  if (isFiniteDuration(duration)) {
    stepState.elapsed = duration;
    return;
  }

  if (!stepState.startedAt) return;
  const diff = new Date(event.ts).getTime() - new Date(stepState.startedAt).getTime();
  if (Number.isFinite(diff) && diff >= 0) {
    stepState.elapsed = diff;
  }
}

export function derivePipelineState(events) {
  const steps = {};
  for (const step of PIPELINE_STEPS) {
    steps[step.id] = {
      status: 'pending',
      startedAt: null,
      completedAt: null,
      elapsed: null,
      attempts: 0,
      error: null,
      fallbackUsed: false,
      fallbackReason: null,
      fallbackProvider: null,
    };
  }

  for (const event of events) {
    const targetStepIds = resolvePipelineTargets(event);
    if (targetStepIds.length === 0) continue;

    const isStart = event.type === 'step.started' || event.type === 'persist.started';
    const isComplete = event.type === 'step.completed' || event.type === 'persist.completed';
    const isFailed = event.type === 'step.failed' || event.type === 'persist.failed';

    for (const stepId of targetStepIds) {
      const s = steps[stepId];
      if (!s) continue;

      if (isStart) {
        s.status = 'running';
        s.startedAt = s.startedAt || event.ts;
        s.attempts++;
      } else if (isComplete) {
        s.status = 'complete';
        s.completedAt = event.ts;
        updateElapsed(s, event);
        if (stepId === 'render') {
          const fallbackUsed = event?.data?.fallbackUsed;
          if (typeof fallbackUsed === 'boolean') {
            s.fallbackUsed = fallbackUsed;
          }
          if (typeof event?.data?.fallbackReason === 'string') {
            s.fallbackReason = event.data.fallbackReason;
          }
          if (typeof event?.data?.fallbackProvider === 'string') {
            s.fallbackProvider = event.data.fallbackProvider;
          } else if (event?.data?.meta && typeof event.data.meta === 'object' && typeof event.data.meta.provider === 'string') {
            s.fallbackProvider = event.data.meta.provider;
          }
        }
      } else if (isFailed) {
        s.status = 'failed';
        s.completedAt = event.ts;
        s.error = event.message || 'Failed';
        updateElapsed(s, event);
      }
    }
  }

  return steps;
}

export function renderPipeline(events) {
  const steps = derivePipelineState(events);

  const parts = [];
  for (let i = 0; i < PIPELINE_STEPS.length; i++) {
    const def = PIPELINE_STEPS[i];
    const s = steps[def.id];
    const stepClass = `step-${s.status}`;

    parts.push(`
      <div class="pipeline-step ${stepClass}">
        <div class="pipeline-node"><div class="pipeline-node-inner"></div></div>
        <div class="pipeline-label">${def.label}</div>
        ${def.id === 'render' && s.fallbackUsed
          ? `<div class="pipeline-fallback-badge" title="Render fallback used${s.fallbackProvider ? ` (${escapeHtml(s.fallbackProvider)})` : ''}${s.fallbackReason ? `: ${escapeHtml(s.fallbackReason)}` : ''}">Hyperrender</div>`
          : ''}
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

export function renderTimeline(events) {
  if (events.length === 0) {
    return '<div class="empty-state">No events recorded</div>';
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
