import type { ArtifactKind } from './types.js';

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
  | 'workflow.started'
  | 'workflow.completed'
  | 'workflow.failed'
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
export type TerminalState = 'done' | 'failed';

/**
 * Summary derived from events (cached for fast reads).
 */
export interface DerivedSummary {
  stage: RequestStage | TerminalState;
  errorCount: number;
  lastEventTs: string | undefined;
  terminal: boolean;
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
