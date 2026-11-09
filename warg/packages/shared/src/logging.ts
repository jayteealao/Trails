import type { ArtifactKind } from './types.js';
import type { RequestDiagnostics } from './dashboard.js';
import type { SettledRecord } from './settle.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type EventSource =
  | 'gateway'
  | 'workflow'
  | 'renderer'
  | 'singlefile'
  | 'readability'
  | 'monolith'
  | 'gcs'
  | 'logger';

export type EventType =
  | 'request.created'
  | 'request.done'
  | 'request.failed'
  | 'request.settled'
  | 'workflow.started'
  | 'workflow.completed'
  | 'workflow.failed'
  | 'workflow.trigger_failed'
  | 'step.started'
  | 'step.completed'
  | 'step.failed'
  | 'artifact.written'
  | 'persist.started'
  | 'persist.completed'
  | 'persist.failed';

export interface LogEvent {
  ts: string;
  source: EventSource;
  type: EventType;
  level: LogLevel;
  message: string;
  attempt?: number;
  data?: Record<string, unknown>;
}

export interface ArtifactRecord {
  kind: ArtifactKind;
  r2Key: string;
  contentType: string;
  bytes: number;
  sha256: string;
}

/**
 * Request stage (for UI display, derived from events).
 */
export type RequestStage = 'queued' | 'rendering' | 'deriving' | 'persisting';

/**
 * Terminal state (for UI display, derived from events).
 */
export type TerminalState = 'done' | 'failed' | 'incomplete';

/**
 * Summary derived from events (cached for fast reads).
 */
export interface DerivedSummary {
  stage: RequestStage | TerminalState;
  errorCount: number;
  lastEventTs: string | undefined;
  terminal: boolean;
  diagnostics?: RequestDiagnostics;
  /** The state the workflow settled the request in; it holds until a new run reopens the request. */
  settled?: SettledRecord;
  /** The time of the last reopen (`request.created` or `workflow.started`). */
  openedAt?: string;
}

/**
 * Full canonical view of a request (metadata + events + artifacts).
 */
export interface CanonicalRequestView {
  requestId: string;
  url: string;
  createdAt: string;
  optionsR2Key: string | undefined;
  manifestR2Key: string | undefined;
  externalJson: Record<string, unknown> | undefined;
  derived: DerivedSummary;
  events: LogEvent[];
  artifacts: ArtifactRecord[];
  nextCursor?: number;
}

/**
 * Payload for initializing a new request in the logger.
 */
export interface InitRequestPayload {
  requestId: string;
  url: string;
  optionsR2Key?: string;
}

/**
 * Patch for updating request fields.
 */
export interface RequestFieldsPatch {
  manifestR2Key?: string;
  externalJson?: Record<string, unknown>;
}

/**
 * Create a log event with the given source.
 */
export function createEvent(
  source: EventSource,
  type: EventType,
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>
): LogEvent {
  return {
    ts: new Date().toISOString(),
    source,
    type,
    level,
    message,
    data
  };
}
