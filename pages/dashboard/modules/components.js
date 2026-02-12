// @ts-check
import { PIPELINE_STEPS, STAGE_COLORS } from './state.js';
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
    };
  }

  for (const event of events) {
    const step = PIPELINE_STEPS.find(s => s.source === event.source);
    if (!step) continue;

    const s = steps[step.id];

    if (event.type === 'step.started') {
      s.status = 'running';
      s.startedAt = s.startedAt || event.ts;
      s.attempts++;
    } else if (event.type === 'step.completed') {
      s.status = 'complete';
      s.completedAt = event.ts;
      if (s.startedAt) {
        s.elapsed = new Date(event.ts) - new Date(s.startedAt);
      }
    } else if (event.type === 'step.failed') {
      s.status = 'failed';
      s.completedAt = event.ts;
      s.error = event.message || 'Failed';
      if (s.startedAt) {
        s.elapsed = new Date(event.ts) - new Date(s.startedAt);
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
