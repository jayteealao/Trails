/**
 * The render-fallback fields of the request diagnostics, read from one event.
 * The live fold (LoggerDO) and the recompute from stored events (index.ts)
 * both call it, so the two paths cannot drift.
 */

import type { LogEvent, RequestDiagnostics } from '@warg/shared';
import { asBoolean, asRecord, asRenderStealth, asString } from './value-helpers.js';

export function normalizeRenderProvider(value: string | undefined): RequestDiagnostics['renderProvider'] | undefined {
  if (!value) return undefined;
  const lower = value.toLowerCase();
  if (lower === 'hyperbrowser') return 'hyperbrowser';
  if (lower === 'browser-rendering' || lower === 'browser_rendering') return 'browser-rendering';
  return 'unknown';
}

/**
 * Fold the fallback, its reason, its stealth setting and the render provider of
 * a render event into the diagnostics. A fallback render is recorded whether it
 * answered (step.completed) or failed (step.failed); any other event is ignored.
 */
export function applyRenderFallbackDiagnostics(diagnostics: RequestDiagnostics, event: LogEvent): void {
  const data = event.data;
  if (event.type !== 'step.completed' && event.type !== 'step.failed') return;
  if (asString(data?.['step']) !== 'render') return;

  const fallbackUsed = asBoolean(data?.['fallbackUsed']);
  if (fallbackUsed !== undefined) diagnostics.renderFallbackUsed = fallbackUsed;

  const fallbackReason = asString(data?.['fallbackReason']);
  if (fallbackReason) diagnostics.renderFallbackReason = fallbackReason;

  const fallbackStealth = asRenderStealth(data?.['fallbackStealth']);
  if (fallbackStealth) diagnostics.renderFallbackStealth = fallbackStealth;

  const meta = asRecord(data?.['meta']);
  const provider = normalizeRenderProvider(
    asString(data?.['fallbackProvider']) ??
      asString(meta?.['provider']) ??
      (fallbackUsed === false ? 'browser-rendering' : undefined)
  );
  if (provider) {
    diagnostics.renderProvider = provider;
  } else if (fallbackUsed === true) {
    diagnostics.renderProvider = 'hyperbrowser';
  }
}
