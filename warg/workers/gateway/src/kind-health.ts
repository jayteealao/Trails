import type { ArtifactKind, KindHealthArtifact, KindHealthRow, WorkflowStep } from '@warg/shared';
import { HEALTH_KIND_ARTIFACTS } from '@warg/shared';

const HOUR_MS = 3_600_000;

/** The archive kinds, in the order the check reports them. */
const KINDS: readonly WorkflowStep[] = ['render', 'singlefile', 'readability', 'monolith'];

export interface HealthThresholds {
  /** Alert when the success ratio of the window is below this. */
  minRatio: number;
  /** Apply the ratio only when the kind had at least this many requests in the window. */
  minRequests: number;
  /** The window of the ratio, in hours. */
  windowHours: number;
  /** Alert when the last success is at least this many hours old. */
  staleAfterHours: number;
}

/** Below 80% success in 24 hours with at least 5 requests, or no success for 48 hours. */
export const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = {
  minRatio: 0.8,
  minRequests: 5,
  windowHours: 24,
  staleAfterHours: 48
};

export type HealthAlertReason = 'low-ratio' | 'stale';

export interface KindStats {
  kind: WorkflowStep;
  requested: number;
  succeeded: number;
  /** Undefined when the kind had no request in the window. */
  ratio: number | undefined;
  lastSuccessAt: string | undefined;
}

export interface KindAlert extends KindStats {
  reasons: HealthAlertReason[];
}

/**
 * Measures each archive kind and returns the kinds to alert on. A success is
 * the creation time of the kind's primary artifact, never a step status.
 */
export function evaluateKindHealth(
  rows: KindHealthRow[],
  now: Date,
  thresholds: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS
): { stats: KindStats[]; alerts: KindAlert[] } {
  const nowMs = now.getTime();
  const windowStartMs = nowMs - thresholds.windowHours * HOUR_MS;
  const inWindow = (iso: string): boolean => {
    const ms = Date.parse(iso);
    return ms >= windowStartMs && ms <= nowMs;
  };

  const stats = KINDS.map((kind): KindStats => {
    const artifactKind = HEALTH_KIND_ARTIFACTS[kind];
    let requested = 0;
    let succeeded = 0;
    let lastSuccessMs: number | undefined;

    for (const row of rows) {
      const artifact = row.artifacts.find((entry) => entry.kind === artifactKind);
      if (artifact) {
        const ms = Date.parse(artifact.createdAt);
        if (lastSuccessMs === undefined || ms > lastSuccessMs) lastSuccessMs = ms;
      }
      // A row that predates the requested-steps field counts as asking for every kind.
      const asked = row.requestedSteps === undefined || row.requestedSteps.includes(kind);
      if (!asked || !inWindow(row.createdAt)) continue;
      requested += 1;
      if (artifact && inWindow(artifact.createdAt)) succeeded += 1;
    }

    return {
      kind,
      requested,
      succeeded,
      ratio: requested === 0 ? undefined : succeeded / requested,
      lastSuccessAt: lastSuccessMs === undefined ? undefined : new Date(lastSuccessMs).toISOString()
    };
  });

  const alerts: KindAlert[] = [];
  for (const entry of stats) {
    const reasons: HealthAlertReason[] = [];
    if (entry.requested >= thresholds.minRequests && entry.succeeded / entry.requested < thresholds.minRatio) {
      reasons.push('low-ratio');
    }
    const stale =
      entry.lastSuccessAt === undefined ||
      nowMs - Date.parse(entry.lastSuccessAt) >= thresholds.staleAfterHours * HOUR_MS;
    if (entry.requested >= 1 && stale) reasons.push('stale');
    if (reasons.length > 0) alerts.push({ ...entry, reasons });
  }

  return { stats, alerts };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoTime(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isWorkflowStep(value: unknown): value is WorkflowStep {
  return typeof value === 'string' && KINDS.some((kind) => kind === value);
}

function isHealthArtifactKind(value: unknown): value is ArtifactKind {
  return typeof value === 'string' && KINDS.some((kind) => HEALTH_KIND_ARTIFACTS[kind] === value);
}

function rowError(message: string): Error {
  return new Error(`[gateway] health rows: ${message}`);
}

/** Validates the logger's `/health/kinds` answer and returns its rows. */
export function parseKindHealthPayload(raw: unknown): KindHealthRow[] {
  if (!isRecord(raw) || !Array.isArray(raw.rows)) throw rowError('rows must be an array');

  return raw.rows.map((entry: unknown, index): KindHealthRow => {
    if (!isRecord(entry)) throw rowError(`row ${index} must be an object`);
    const { requestId, createdAt, requestedSteps, artifacts } = entry;
    if (typeof requestId !== 'string') throw rowError(`row ${index} requestId must be a string`);
    if (!isIsoTime(createdAt)) throw rowError(`row ${index} createdAt must be a time`);
    if (!Array.isArray(artifacts)) throw rowError(`row ${index} artifacts must be an array`);

    const parsedArtifacts = artifacts.map((artifact: unknown): KindHealthArtifact => {
      if (!isRecord(artifact) || !isHealthArtifactKind(artifact.kind) || !isIsoTime(artifact.createdAt)) {
        throw rowError(`row ${index} has an invalid artifact`);
      }
      return { kind: artifact.kind, createdAt: artifact.createdAt };
    });

    if (requestedSteps === undefined) return { requestId, createdAt, artifacts: parsedArtifacts };
    if (!Array.isArray(requestedSteps) || !requestedSteps.every(isWorkflowStep)) {
      throw rowError(`row ${index} requestedSteps must list known steps`);
    }
    return { requestId, createdAt, requestedSteps, artifacts: parsedArtifacts };
  });
}

const THRESHOLD_LIMITS: Record<'minRatio' | 'minRequests' | 'staleAfterHours', { min: number; max: number; integer: boolean }> = {
  minRatio: { min: 0, max: 1, integer: false },
  minRequests: { min: 1, max: 1000, integer: true },
  staleAfterHours: { min: 0, max: 48, integer: true }
};

function isThresholdKey(key: string): key is keyof typeof THRESHOLD_LIMITS {
  return Object.hasOwn(THRESHOLD_LIMITS, key);
}

/** The thresholds of an on-demand run: the defaults with bounded overrides. The window is fixed. */
export function parseThresholdOverrides(raw: unknown): HealthThresholds {
  if (raw === undefined) return { ...DEFAULT_HEALTH_THRESHOLDS };
  if (!isRecord(raw)) throw new Error('invalid threshold: thresholds');

  const thresholds = { ...DEFAULT_HEALTH_THRESHOLDS };
  for (const [key, value] of Object.entries(raw)) {
    if (!isThresholdKey(key)) throw new Error(`invalid threshold: ${key}`);
    const limit = THRESHOLD_LIMITS[key];
    const valid =
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= limit.min &&
      value <= limit.max &&
      (!limit.integer || Number.isInteger(value));
    if (!valid) throw new Error(`invalid threshold: ${key}`);
    thresholds[key] = value;
  }
  return thresholds;
}

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** The one email of a run: a block per alerting kind. Holds no URL, request id or secret. */
export function buildHealthEmail(
  alerts: KindAlert[],
  now: Date,
  thresholds: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS
): { subject: string; text: string } {
  const blocks = alerts.map((alert) => {
    const success =
      alert.ratio === undefined
        ? `no requests in the last ${thresholds.windowHours} hours`
        : `success ${alert.succeeded}/${alert.requested} (${percent(alert.ratio)}) in the last ${thresholds.windowHours} hours`;
    const last = alert.lastSuccessAt ?? 'none in the last 48 hours';
    const lines = [`${alert.kind} — ${success}; last success ${last}`];
    for (const reason of alert.reasons) {
      lines.push(
        reason === 'low-ratio'
          ? `  - below ${percent(thresholds.minRatio)} success with at least ${thresholds.minRequests} requests`
          : `  - no success for ${thresholds.staleAfterHours} hours or more`
      );
    }
    return lines.join('\n');
  });

  return {
    subject: `Warg archive health: ${alerts.length} kind(s) need attention`,
    text: [...blocks, `Checked at ${now.toISOString()}`].join('\n\n')
  };
}
