import { describe, expect, it } from 'vitest';
import type { LogEvent, RequestDiagnostics } from '@warg/shared';
import { applyRenderFallbackDiagnostics } from './render-fallback-diagnostics.js';

function renderEvent(type: LogEvent['type'], data: Record<string, unknown>): LogEvent {
  return { ts: '2026-11-11T00:00:00Z', type, source: 'workflow', level: 'info', message: '', data: { step: 'render', ...data } };
}

function fold(event: LogEvent): RequestDiagnostics {
  const diagnostics: RequestDiagnostics = { retryCount: 0 };
  applyRenderFallbackDiagnostics(diagnostics, event);
  return diagnostics;
}

describe('applyRenderFallbackDiagnostics', () => {
  it('records an answered fallback with its reason, stealth setting and provider', () => {
    expect(
      fold(
        renderEvent('step.completed', {
          fallbackUsed: true,
          fallbackReason: 'browser_rendering_dead_host',
          fallbackProvider: 'Hyperbrowser',
          fallbackStealth: 'none',
        })
      )
    ).toEqual({
      retryCount: 0,
      renderFallbackUsed: true,
      renderFallbackReason: 'browser_rendering_dead_host',
      renderFallbackStealth: 'none',
      renderProvider: 'hyperbrowser',
    });
  });

  it('records a failed fallback and drops an unknown stealth setting', () => {
    expect(
      fold(renderEvent('step.failed', { fallbackUsed: true, fallbackReason: 'browser_rendering_403', fallbackStealth: 'sneaky' }))
    ).toEqual({
      retryCount: 0,
      renderFallbackUsed: true,
      renderFallbackReason: 'browser_rendering_403',
      renderProvider: 'hyperbrowser',
    });
  });

  it('reads the primary renderer when no fallback ran', () => {
    expect(fold(renderEvent('step.completed', { fallbackUsed: false })).renderProvider).toBe('browser-rendering');
  });

  it('ignores events of other steps and types', () => {
    expect(fold(renderEvent('step.started', { fallbackUsed: true }))).toEqual({ retryCount: 0 });
    const other: LogEvent = { ...renderEvent('step.completed', {}), data: { step: 'monolith', fallbackUsed: true } };
    expect(fold(other)).toEqual({ retryCount: 0 });
  });
});
