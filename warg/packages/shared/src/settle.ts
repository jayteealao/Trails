import { isRequestErrorCode, isUserActionHint } from './dashboard.js';
import type { RequestErrorCode, UserActionHint } from './dashboard.js';
import type { TerminalState } from './logging.js';

const TERMINAL_STATES: readonly TerminalState[] = ['done', 'failed', 'incomplete'];
const MAX_RUN_ID_LENGTH = 128;
const MAX_ERROR_MESSAGE_LENGTH = 500;

/**
 * The terminal state a workflow run settled a request in, sent to the logger once per run.
 * `runId` and `settledAt` order settles: a retried settle of the same run is a duplicate,
 * and a settle older than the stored one or than the last reopen is stale.
 */
export interface RequestSettle {
  state: TerminalState;
  runId: string;
  settledAt: string;
  errorCode?: RequestErrorCode;
  errorMessage?: string;
  retryable?: boolean;
  recommendedAction?: UserActionHint;
}

/** The settle the logger applied, with the error fields as they stood after it. */
export type SettledRecord = RequestSettle;

function isTerminalState(value: unknown): value is TerminalState {
  return TERMINAL_STATES.some((state) => state === value);
}

/** Validate a settle body; answers undefined for anything that is not a valid settle. */
export function parseRequestSettle(value: unknown): RequestSettle | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const field = (key: string): unknown => Reflect.get(value, key);
  const state = field('state');
  const runId = field('runId');
  const settledAt = field('settledAt');
  const errorCode = field('errorCode');
  const errorMessage = field('errorMessage');
  const retryable = field('retryable');
  const recommendedAction = field('recommendedAction');
  if (!isTerminalState(state)) return undefined;
  if (typeof runId !== 'string' || runId.length === 0 || runId.length > MAX_RUN_ID_LENGTH) return undefined;
  if (typeof settledAt !== 'string' || Number.isNaN(Date.parse(settledAt))) return undefined;

  const settle: RequestSettle = { state, runId, settledAt };
  if (isRequestErrorCode(errorCode)) settle.errorCode = errorCode;
  if (typeof errorMessage === 'string') settle.errorMessage = errorMessage.slice(0, MAX_ERROR_MESSAGE_LENGTH);
  if (typeof retryable === 'boolean') settle.retryable = retryable;
  if (isUserActionHint(recommendedAction)) settle.recommendedAction = recommendedAction;
  return settle;
}

/** A degraded archive is incomplete when any step's output is missing. */
export function isIncompleteDegradation(degradedSteps: readonly string[] | undefined): boolean {
  return (degradedSteps?.length ?? 0) > 0;
}
