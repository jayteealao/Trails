import { isRequestErrorCode, isUserActionHint } from './dashboard.js';
import type { RequestErrorCode, UserActionHint } from './dashboard.js';

/** How a failure is classified: its code, whether a retry can help, and what to do next. */
export interface ErrorClassification {
  errorCode: RequestErrorCode;
  retryable: boolean;
  recommendedAction: UserActionHint;
}

// --- The classification tag --------------------------------------------------

/**
 * A step failure leaves its step as a message only: properties set on the error object
 * do not survive the step boundary. The classification made where the failure was seen
 * therefore travels as a tag at the end of the message, and the failure log reads it
 * back instead of guessing from the message text.
 */
const CLASSIFICATION_TAG = /\[classified ([A-Z0-9_]+) (retryable|final) ([a-z_]+)\]/g;

/** The message with the classification tag appended. */
export function withClassificationTag(message: string, classification: ErrorClassification): string {
  const retry = classification.retryable ? 'retryable' : 'final';
  return `${message} [classified ${classification.errorCode} ${retry} ${classification.recommendedAction}]`;
}

/** The classification of the last valid tag in a message, or undefined when it carries none. */
export function readClassificationTag(message: string): ErrorClassification | undefined {
  let found: ErrorClassification | undefined;
  for (const [, errorCode = '', retry, recommendedAction = ''] of message.matchAll(CLASSIFICATION_TAG)) {
    if (isRequestErrorCode(errorCode) && isUserActionHint(recommendedAction)) {
      found = { errorCode, retryable: retry === 'retryable', recommendedAction };
    }
  }
  return found;
}

// --- Monolith text rules -----------------------------------------------------

/**
 * Detect the Cloudflare Sandbox RPC 32 MiB size-limit error from its message.
 *
 * Hit when a value crossing the host↔container RPC boundary (exec output capture
 * or `readFile`/`writeFile`) exceeds the serialized-RPC ceiling. monolith
 * base64-inlines every asset, so a heavy page can yield >32 MiB of output. This
 * is deterministic for a given input, so callers must treat it as
 * NON-retryable.
 */
export function isRpc32MiBLimit(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('32mib') ||
    lower.includes('33554432') ||
    lower.includes('message length too big') ||
    lower.includes('max allowed message length')
  );
}

/** True when a message reports the workflow's refusal of a monolith input over its size cap. */
export function isMonolithInputTooLarge(message: string): boolean {
  return message.toLowerCase().includes('monolith input too large');
}

/** The sandbox's own timeout words: unlike the service and message rules, `abort` is not one. */
function isSandboxTimeoutText(lower: string): boolean {
  return lower.includes('timeout') || lower.includes('timed out') || lower.includes('deadline exceeded');
}

export type SandboxFailureCode = 'MONOLITH_RPC_32MIB_LIMIT' | 'MONOLITH_TIMEOUT' | 'MONOLITH_SANDBOX_500';

/** How a failed command inside the monolith sandbox is classified, from its stderr and stdout. */
export function classifySandboxOutput(
  stderr: string,
  stdout: string
): { errorCode: SandboxFailureCode; retryable: boolean } {
  const message = `${stderr}\n${stdout}`.toLowerCase();
  if (isRpc32MiBLimit(message)) return { errorCode: 'MONOLITH_RPC_32MIB_LIMIT', retryable: false };
  if (isSandboxTimeoutText(message)) return { errorCode: 'MONOLITH_TIMEOUT', retryable: true };
  return { errorCode: 'MONOLITH_SANDBOX_500', retryable: true };
}
