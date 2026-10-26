import { Timestamp } from 'firebase-admin/firestore';
import type { DocumentData } from 'firebase-admin/firestore';
import type {
  BackfillTracker,
  BatchEntry,
  ChangeMarker,
  DomainBackoffState,
  FailureClass,
  RetryEntry,
  RunSummary,
} from './types.js';

function asTimestamp(value: unknown): Timestamp | null {
  if (!value || typeof value !== 'object') return null;
  const maybeTs = value as { toMillis?: unknown };
  return typeof maybeTs.toMillis === 'function'
    ? (value as Timestamp)
    : null;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function normalizeBatch(raw: unknown): BatchEntry[] {
  if (!Array.isArray(raw)) return [];
  const now = Timestamp.now();
  const out: BatchEntry[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const itemId = typeof rec['item_id'] === 'string' ? rec['item_id'] : '';
    const url = typeof rec['url'] === 'string' ? rec['url'] : '';
    if (!itemId || !url) continue;

    const domain =
      typeof rec['domain'] === 'string' && rec['domain'].length > 0
        ? rec['domain']
        : extractDomain(url);
    const sentAt = asTimestamp(rec['sent_at']) ?? now;
    const retryCount =
      typeof rec['retry_count'] === 'number' && Number.isFinite(rec['retry_count'])
        ? rec['retry_count']
        : 0;

    out.push({
      item_id: itemId,
      url,
      domain,
      sent_at: sentAt,
      retry_count: retryCount,
    });
  }

  return out;
}

export function createDefaultRunSummary(): RunSummary {
  return {
    considered: 0,
    eligible: 0,
    triggered: 0,
    linked_only: 0,
    skipped_backoff: 0,
    failed: 0,
  };
}

export function createDefaultTracker(now = Timestamp.now()): BackfillTracker {
  return {
    batch: [],
    batch_started_at: null,
    batch_number: 0,
    scan_cursor: null,
    scan_exhausted: false,
    total_sent: 0,
    total_completed: 0,
    total_failed: 0,
    consecutive_all_failed: 0,
    last_run_at: now,
    last_run_result: 'idle',
    paused: false,
    global_pause_until: null,
    pause_reason: null,
    run_lease: null,
    domain_backoff: {},
    last_run_summary: createDefaultRunSummary(),
    pass_label: null,
    pass_started_at: null,
    pass_completed_at: null,
    change_marker: null,
    retry_queue: [],
  };
}

function normalizeChangeMarker(raw: unknown): ChangeMarker | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const timeUpdated = rec['time_updated'];
  const itemId = rec['item_id'];
  if (typeof timeUpdated !== 'number' || !Number.isFinite(timeUpdated)) return null;
  if (typeof itemId !== 'string') return null;
  return { time_updated: timeUpdated, item_id: itemId };
}

function normalizeRetryQueue(raw: unknown): RetryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: RetryEntry[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const itemId = typeof rec['item_id'] === 'string' ? rec['item_id'] : '';
    const url = typeof rec['url'] === 'string' ? rec['url'] : '';
    if (!itemId || !url) continue;

    out.push({
      item_id: itemId,
      url,
      domain:
        typeof rec['domain'] === 'string' && rec['domain'].length > 0
          ? rec['domain']
          : extractDomain(url),
      retry_count:
        typeof rec['retry_count'] === 'number' && Number.isFinite(rec['retry_count'])
          ? rec['retry_count']
          : 0,
      not_before: asTimestamp(rec['not_before']) ?? Timestamp.fromMillis(0),
    });
  }

  return out;
}

function normalizeDomainBackoff(
  raw: unknown
): Record<string, DomainBackoffState> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const output: Record<string, DomainBackoffState> = {};

  for (const [domain, value] of Object.entries(source)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    const consecutive = entry['consecutive_failures'];
    output[domain] = {
      consecutive_failures:
        typeof consecutive === 'number' && Number.isFinite(consecutive)
          ? consecutive
          : 0,
      backoff_until: asTimestamp(entry['backoff_until']),
      last_error:
        typeof entry['last_error'] === 'string' ? entry['last_error'] : null,
    };
  }

  return output;
}

export function normalizeTracker(raw: DocumentData | undefined): BackfillTracker {
  const base = createDefaultTracker();
  if (!raw) return base;

  const tracker = raw as Record<string, unknown>;
  const lastRunAt = asTimestamp(tracker['last_run_at']);
  const batchStartedAt = asTimestamp(tracker['batch_started_at']);
  const globalPauseUntil = asTimestamp(tracker['global_pause_until']);
  const runLeaseRaw =
    tracker['run_lease'] && typeof tracker['run_lease'] === 'object'
      ? (tracker['run_lease'] as Record<string, unknown>)
      : null;
  const runLeaseExpiresAt = runLeaseRaw
    ? asTimestamp(runLeaseRaw['expires_at'])
    : null;

  return {
    ...base,
    batch: normalizeBatch(tracker['batch']),
    ...(batchStartedAt ? { batch_started_at: batchStartedAt } : {}),
    ...(typeof tracker['batch_number'] === 'number'
      ? { batch_number: tracker['batch_number'] }
      : {}),
    ...(typeof tracker['scan_cursor'] === 'string'
      ? { scan_cursor: tracker['scan_cursor'] }
      : {}),
    ...(tracker['scan_cursor'] === null ? { scan_cursor: null } : {}),
    scan_exhausted: tracker['scan_exhausted'] === true,
    ...(typeof tracker['total_sent'] === 'number'
      ? { total_sent: tracker['total_sent'] }
      : {}),
    ...(typeof tracker['total_completed'] === 'number'
      ? { total_completed: tracker['total_completed'] }
      : {}),
    ...(typeof tracker['total_failed'] === 'number'
      ? { total_failed: tracker['total_failed'] }
      : {}),
    ...(typeof tracker['consecutive_all_failed'] === 'number'
      ? { consecutive_all_failed: tracker['consecutive_all_failed'] }
      : {}),
    ...(lastRunAt ? { last_run_at: lastRunAt } : {}),
    ...(typeof tracker['last_run_result'] === 'string'
      ? { last_run_result: tracker['last_run_result'] as BackfillTracker['last_run_result'] }
      : {}),
    paused: tracker['paused'] === true,
    global_pause_until: globalPauseUntil,
    pause_reason:
      typeof tracker['pause_reason'] === 'string' ? tracker['pause_reason'] : null,
    run_lease:
      runLeaseRaw &&
      typeof runLeaseRaw['owner'] === 'string' &&
      runLeaseExpiresAt
        ? {
            owner: runLeaseRaw['owner'],
            expires_at: runLeaseExpiresAt,
          }
        : null,
    domain_backoff: normalizeDomainBackoff(tracker['domain_backoff']),
    last_run_summary:
      tracker['last_run_summary'] &&
      typeof tracker['last_run_summary'] === 'object'
        ? {
            ...createDefaultRunSummary(),
            ...(tracker['last_run_summary'] as Record<string, unknown>),
          }
        : createDefaultRunSummary(),
    pass_label:
      typeof tracker['pass_label'] === 'string' ? tracker['pass_label'] : null,
    pass_started_at: asTimestamp(tracker['pass_started_at']),
    pass_completed_at: asTimestamp(tracker['pass_completed_at']),
    change_marker: normalizeChangeMarker(tracker['change_marker']),
    retry_queue: normalizeRetryQueue(tracker['retry_queue']),
  };
}

/**
 * Adds a retry entry, keeping one entry per shared article (the higher
 * retry_count wins). Beyond `max` entries the oldest is dropped; returns
 * whether one was dropped.
 */
export function enqueueRetry(
  tracker: BackfillTracker,
  entry: RetryEntry,
  max = 200
): boolean {
  const existing = tracker.retry_queue.findIndex((e) => e.item_id === entry.item_id);
  if (existing >= 0) {
    const current = tracker.retry_queue[existing]!;
    tracker.retry_queue[existing] =
      entry.retry_count >= current.retry_count ? entry : current;
    return false;
  }

  tracker.retry_queue.push(entry);
  if (tracker.retry_queue.length > max) {
    tracker.retry_queue.shift();
    return true;
  }
  return false;
}

/** Returns up to `max` due entries in not_before order, without removing them. */
export function takeDueRetries(
  tracker: BackfillTracker,
  nowMs: number,
  max: number
): RetryEntry[] {
  return tracker.retry_queue
    .filter((e) => e.not_before.toMillis() <= nowMs)
    .sort((a, b) => a.not_before.toMillis() - b.not_before.toMillis())
    .slice(0, max);
}

export function isDomainBackedOff(
  tracker: BackfillTracker,
  domain: string,
  nowMs: number
): boolean {
  const entry = tracker.domain_backoff[domain];
  if (!entry?.backoff_until) return false;
  return entry.backoff_until.toMillis() > nowMs;
}

export function pruneExpiredDomainBackoff(
  tracker: BackfillTracker,
  nowMs: number
): void {
  for (const [domain, entry] of Object.entries(tracker.domain_backoff)) {
    if (!entry.backoff_until) continue;
    if (entry.backoff_until.toMillis() <= nowMs) {
      tracker.domain_backoff[domain] = {
        ...entry,
        backoff_until: null,
      };
    }
  }
}

export function recordDomainSuccess(
  tracker: BackfillTracker,
  domain: string
): void {
  const existing = tracker.domain_backoff[domain];
  if (!existing) return;
  tracker.domain_backoff[domain] = {
    consecutive_failures: 0,
    backoff_until: null,
    last_error: null,
  };
}

export function recordDomainFailure(
  tracker: BackfillTracker,
  domain: string,
  nowMs: number,
  threshold: number,
  backoffMs: number,
  error: string | null
): void {
  const existing = tracker.domain_backoff[domain] ?? {
    consecutive_failures: 0,
    backoff_until: null,
    last_error: null,
  };
  const consecutive = existing.consecutive_failures + 1;
  tracker.domain_backoff[domain] = {
    consecutive_failures: consecutive,
    backoff_until:
      consecutive >= threshold
        ? Timestamp.fromMillis(nowMs + backoffMs)
        : existing.backoff_until,
    last_error: error,
  };
}

export function shouldPauseGlobally(
  failuresByClass: Record<FailureClass, number>,
  failedCount: number
): boolean {
  if (failedCount < 3) return false;
  const accessFailures = failuresByClass.ACCESS_OR_AUTH;
  return accessFailures >= Math.ceil(failedCount * 0.8);
}
