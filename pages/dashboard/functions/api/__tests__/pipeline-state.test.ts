import { describe, it, expect } from 'vitest';
// @ts-ignore - dashboard runtime modules are plain JS and intentionally imported in tests.
import { derivePipelineState } from '../../../modules/components.js';

type TestEvent = {
  ts: string;
  source: string;
  type: string;
  level?: string;
  message?: string;
  data?: Record<string, unknown>;
};

function event(overrides: Partial<TestEvent>): TestEvent {
  return {
    ts: '2026-02-15T00:00:00.000Z',
    source: 'workflow',
    type: 'step.started',
    level: 'info',
    message: '',
    ...overrides,
  };
}

describe('derivePipelineState', () => {
  it('maps workflow step events using data.step and marks render complete', () => {
    const state = derivePipelineState([
      event({
        ts: '2026-02-15T00:00:00.000Z',
        source: 'workflow',
        type: 'step.started',
        data: { step: 'render' },
      }),
      event({
        ts: '2026-02-15T00:00:02.000Z',
        source: 'workflow',
        type: 'step.completed',
        data: { step: 'render', duration_ms: 1500 },
      }),
    ]);

    expect(state.render.status).toBe('complete');
    expect(state.render.attempts).toBe(1);
    expect(state.render.elapsed).toBe(1500);
  });

  it('captures render fallback metadata from render completion event', () => {
    const state = derivePipelineState([
      event({
        ts: '2026-02-15T00:00:00.000Z',
        source: 'workflow',
        type: 'step.started',
        data: { step: 'render' },
      }),
      event({
        ts: '2026-02-15T00:00:02.000Z',
        source: 'workflow',
        type: 'step.completed',
        data: {
          step: 'render',
          duration_ms: 1000,
          fallbackUsed: true,
          fallbackReason: 'browser_rendering_403',
          fallbackProvider: 'hyperbrowser',
        },
      }),
    ]);

    expect(state.render.status).toBe('complete');
    expect(state.render.fallbackUsed).toBe(true);
    expect(state.render.fallbackReason).toBe('browser_rendering_403');
    expect(state.render.fallbackProvider).toBe('hyperbrowser');
  });

  it('maps derivatives events to both readability and monolith', () => {
    const state = derivePipelineState([
      event({
        ts: '2026-02-15T00:01:00.000Z',
        source: 'workflow',
        type: 'step.started',
        data: { step: 'derivatives' },
      }),
      event({
        ts: '2026-02-15T00:01:01.000Z',
        source: 'workflow',
        type: 'step.completed',
        data: { step: 'derivatives' },
      }),
    ]);

    expect(state.readability.status).toBe('complete');
    expect(state.monolith.status).toBe('complete');
    expect(state.readability.attempts).toBe(1);
    expect(state.monolith.attempts).toBe(1);
  });

  it('uses persist events to drive persist node state and duration', () => {
    const state = derivePipelineState([
      event({
        ts: '2026-02-15T00:02:00.000Z',
        source: 'workflow',
        type: 'persist.started',
      }),
      event({
        ts: '2026-02-15T00:02:05.000Z',
        source: 'workflow',
        type: 'persist.completed',
        data: { duration_ms: 4200 },
      }),
    ]);

    expect(state.persist.status).toBe('complete');
    expect(state.persist.attempts).toBe(1);
    expect(state.persist.elapsed).toBe(4200);
  });

  it('keeps legacy source-based mapping for older logs', () => {
    const state = derivePipelineState([
      event({
        ts: '2026-02-15T00:03:00.000Z',
        source: 'renderer',
        type: 'step.started',
        data: {},
      }),
      event({
        ts: '2026-02-15T00:03:02.000Z',
        source: 'renderer',
        type: 'step.completed',
        data: {},
      }),
    ]);

    expect(state.render.status).toBe('complete');
    expect(state.render.attempts).toBe(1);
  });

  it('marks readability and monolith failed for derivatives failure', () => {
    const state = derivePipelineState([
      event({
        ts: '2026-02-15T00:04:00.000Z',
        source: 'workflow',
        type: 'step.started',
        data: { step: 'derivatives' },
      }),
      event({
        ts: '2026-02-15T00:04:03.000Z',
        source: 'workflow',
        type: 'step.failed',
        message: 'Derivative extraction failed',
        data: { step: 'derivatives' },
      }),
    ]);

    expect(state.readability.status).toBe('failed');
    expect(state.monolith.status).toBe('failed');
    expect(state.readability.error).toContain('failed');
    expect(state.monolith.error).toContain('failed');
  });
});
