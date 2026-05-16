import type { Timestamp } from 'firebase-admin/firestore';

export interface BatchEntry {
  item_id: string;
  url: string;
  domain: string;
  sent_at: Timestamp;
  retry_count: number;
}

export interface RunLease {
  owner: string;
  expires_at: Timestamp;
}

export interface DomainBackoffState {
  consecutive_failures: number;
  backoff_until: Timestamp | null;
  last_error: string | null;
}

export interface RunSummary {
  considered: number;
  eligible: number;
  triggered: number;
  linked_only: number;
  skipped_backoff: number;
  failed: number;
}

export interface BackfillTracker {
  batch: BatchEntry[];
  batch_started_at: Timestamp | null;
  batch_number: number;
  scan_cursor: string | null;
  scan_exhausted: boolean;
  total_sent: number;
  total_completed: number;
  total_failed: number;
  consecutive_all_failed: number;
  last_run_at: Timestamp;
  last_run_result:
    | 'sent_batch'
    | 'waiting'
    | 'settled'
    | 'idle'
    | 'backoff'
    | 'busy';
  paused: boolean;
  global_pause_until: Timestamp | null;
  pause_reason: string | null;
  run_lease: RunLease | null;
  domain_backoff: Record<string, DomainBackoffState>;
  last_run_summary: RunSummary;
}

export type ItemStatus = 'complete' | 'failed' | 'stuck' | 'in_progress';

export interface BatchSettlement {
  complete: number;
  failed: number;
  stuck: number;
  inProgress: number;
  stuckIds: string[];
  completeEntries: BatchEntry[];
  failedEntries: BatchEntry[];
  stuckEntries: BatchEntry[];
}

export interface EligibleItem {
  isNew: boolean;
  retryCount: number;
}

export type FailureClass =
  | 'ACCESS_OR_AUTH'
  | 'WORKFLOW_TRIGGER'
  | 'TRANSIENT_UPSTREAM'
  | 'DATA_ISSUE';
