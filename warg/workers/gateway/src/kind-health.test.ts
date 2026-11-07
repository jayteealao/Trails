import { describe, it, expect } from 'vitest';
import type { KindHealthRow, WorkflowStep } from '@warg/shared';
import { HEALTH_KIND_ARTIFACTS } from '@warg/shared';
import {
  DEFAULT_HEALTH_THRESHOLDS,
  buildHealthEmail,
  evaluateKindHealth,
  parseKindHealthPayload,
  parseThresholdOverrides
} from './kind-health.js';

const NOW = new Date('2026-11-07T08:00:00Z');
const HOUR = 3_600_000;

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * HOUR).toISOString();
}

let seq = 0;

/** One request for `kind`, created `createdHoursAgo` ago, with its artifact `artifactHoursAgo` ago when given. */
function row(kind: WorkflowStep, createdHoursAgo: number, artifactHoursAgo?: number): KindHealthRow {
  seq += 1;
  return {
    requestId: `req-${seq}`,
    createdAt: hoursAgo(createdHoursAgo),
    requestedSteps: [kind],
    artifacts:
      artifactHoursAgo === undefined
        ? []
        : [{ kind: HEALTH_KIND_ARTIFACTS[kind], createdAt: hoursAgo(artifactHoursAgo) }]
  };
}

/** `requested` requests for `kind` in the window, of which `succeeded` hold their artifact. */
function batch(kind: WorkflowStep, requested: number, succeeded: number): KindHealthRow[] {
  return Array.from({ length: requested }, (_, i) => (i < succeeded ? row(kind, 2, 1) : row(kind, 2)));
}

function evaluate(rows: KindHealthRow[]) {
  return evaluateKindHealth(rows, NOW, DEFAULT_HEALTH_THRESHOLDS);
}

function statsOf(rows: KindHealthRow[], kind: WorkflowStep) {
  return evaluate(rows).stats.find((stats) => stats.kind === kind)!;
}

function alertOf(rows: KindHealthRow[], kind: WorkflowStep) {
  return evaluate(rows).alerts.find((alert) => alert.kind === kind);
}

describe('evaluateKindHealth', () => {
  it('takes the last success from the artifact creation time', () => {
    const rows = [row('singlefile', 3, 2)];
    expect(statsOf(rows, 'singlefile').lastSuccessAt).toBe(hoursAgo(2));
    expect(alertOf(rows, 'singlefile')).toBeUndefined();
  });

  it('alerts below 80% success with 10 requests', () => {
    const alert = alertOf(batch('singlefile', 10, 7), 'singlefile');
    expect(alert?.reasons).toEqual(['low-ratio']);
    expect(alert?.ratio).toBe(0.7);
    expect(alert?.requested).toBe(10);
    expect(alert?.succeeded).toBe(7);
  });

  it('does not alert at exactly 80% success', () => {
    expect(alertOf(batch('singlefile', 10, 8), 'singlefile')).toBeUndefined();
  });

  it('raises no ratio alert below 5 requests', () => {
    const rows = [...batch('readability', 4, 0), row('readability', 30, 1)];
    expect(alertOf(rows, 'readability')).toBeUndefined();
  });

  it('raises a ratio alert at 5 requests', () => {
    expect(alertOf(batch('readability', 5, 3), 'readability')?.reasons).toEqual(['low-ratio']);
  });

  it('raises nothing for a kind with no requests and no success', () => {
    const result = evaluate(batch('singlefile', 3, 3));
    expect(result.alerts.find((alert) => alert.kind === 'monolith')).toBeUndefined();
    expect(result.stats.find((stats) => stats.kind === 'monolith')).toEqual({
      kind: 'monolith',
      requested: 0,
      succeeded: 0,
      ratio: undefined,
      lastSuccessAt: undefined
    });
  });

  it('alerts when the last success is 50 hours old', () => {
    const rows = [row('monolith', 2), row('monolith', 3), row('monolith', 50, 50)];
    expect(alertOf(rows, 'monolith')?.reasons).toEqual(['stale']);
  });

  it('alerts when the last success is exactly 48 hours old', () => {
    const rows = [row('monolith', 2), row('monolith', 48, 48)];
    expect(alertOf(rows, 'monolith')?.reasons).toEqual(['stale']);
  });

  it('does not alert when the last success is 47 hours old', () => {
    const rows = [row('monolith', 2), row('monolith', 47, 47)];
    expect(alertOf(rows, 'monolith')).toBeUndefined();
  });

  it('alerts with no last success when no row holds one', () => {
    const alert = alertOf([row('render', 2)], 'render');
    expect(alert?.reasons).toEqual(['stale']);
    expect(alert?.lastSuccessAt).toBeUndefined();
  });

  it('counts an older success toward the last success but not toward the window', () => {
    const stats = statsOf([row('render', 25, 25)], 'render');
    expect(stats.requested).toBe(0);
    expect(stats.succeeded).toBe(0);
    expect(stats.lastSuccessAt).toBe(hoursAgo(25));
  });

  it('counts a row without requested steps as asking for every kind', () => {
    const result = evaluate([{ requestId: 'req-old', createdAt: hoursAgo(2), artifacts: [] }]);
    expect(result.stats.map((stats) => [stats.kind, stats.requested])).toEqual([
      ['render', 1],
      ['singlefile', 1],
      ['readability', 1],
      ['monolith', 1]
    ]);
  });

  it('gives both reasons when a kind is below the ratio and stale', () => {
    expect(alertOf(batch('render', 6, 0), 'render')?.reasons).toEqual(['low-ratio', 'stale']);
  });
});

describe('parseThresholdOverrides', () => {
  it('returns the defaults for no overrides', () => {
    expect(parseThresholdOverrides(undefined)).toEqual(DEFAULT_HEALTH_THRESHOLDS);
    expect(parseThresholdOverrides({})).toEqual(DEFAULT_HEALTH_THRESHOLDS);
  });

  it('lowers the stale period to zero', () => {
    expect(parseThresholdOverrides({ staleAfterHours: 0 })).toEqual({ ...DEFAULT_HEALTH_THRESHOLDS, staleAfterHours: 0 });
  });

  it.each([{ minRatio: 2 }, { windowHours: 1 }, { minRequests: 0 }, { staleAfterHours: 49 }, 'x'])(
    'refuses %j',
    (raw) => {
      expect(() => parseThresholdOverrides(raw)).toThrow(/invalid threshold/);
    }
  );
});

describe('parseKindHealthPayload', () => {
  it('returns the rows of a valid payload', () => {
    const rows = [row('render', 2, 1), { requestId: 'r', createdAt: hoursAgo(1), artifacts: [] }];
    expect(parseKindHealthPayload({ since: hoursAgo(49), buckets: 1, rows })).toEqual({ rows, skipped: 0 });
  });

  it('refuses a payload without a rows list', () => {
    expect(() => parseKindHealthPayload({})).toThrow(/\[gateway\] health rows:/);
  });

  it.each([
    ['a non-string createdAt', { requestId: 'r', createdAt: 5, artifacts: [] }],
    ['an unknown step', { requestId: 'r', createdAt: hoursAgo(1), requestedSteps: ['bogus'], artifacts: [] }],
    ['an unknown artifact kind', { requestId: 'r', createdAt: hoursAgo(1), artifacts: [{ kind: 'x', createdAt: hoursAgo(1) }] }]
  ])('leaves out and counts a row with %s, and keeps the others', (_name, bad) => {
    const good = row('render', 2, 1);
    expect(parseKindHealthPayload({ rows: [bad, good] })).toEqual({ rows: [good], skipped: 1 });
  });
});

describe('buildHealthEmail', () => {
  it('names the kind, the counts and the ratio', () => {
    const { alerts } = evaluate(batch('singlefile', 10, 7));
    const email = buildHealthEmail(alerts, NOW);
    expect(email.subject).toBe('Warg archive health: singlefile need attention');
    expect(email.text).toContain('Where to look first:');
    expect(email.text).toContain('singlefile');
    expect(email.text).toContain('7/10');
    expect(email.text).toContain('70%');
    expect(email.text).toContain(NOW.toISOString());
  });

  it('says when a kind has no success at all', () => {
    const { alerts } = evaluate([row('render', 2)]);
    const email = buildHealthEmail(alerts, NOW);
    expect(email.text).toContain('last success none in the last 48 hours');
    expect(email.text).toContain('no success for 48 hours or more');
  });
});
