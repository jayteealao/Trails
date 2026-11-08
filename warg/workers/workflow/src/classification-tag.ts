import { REQUEST_ERROR_CODES, USER_ACTION_HINTS } from '@warg/shared';
import type { RequestErrorCode, UserActionHint } from '@warg/shared';

/** How a failure is classified: its code, whether a retry can help, and what to do next. */
export interface ErrorClassification {
  errorCode: RequestErrorCode;
  retryable: boolean;
  recommendedAction: UserActionHint;
}

/**
 * A step failure leaves its step as a message only: properties set on the error object
 * do not survive the step boundary. The classification made where the failure was seen
 * therefore travels as a tag at the end of the message, and the failure log reads it
 * back instead of guessing from the message text.
 */
const CLASSIFICATION_TAG = /\[classified ([A-Z0-9_]+) (retryable|final) ([a-z_]+)\]/g;

const ERROR_CODES: ReadonlySet<string> = new Set(REQUEST_ERROR_CODES);
const ACTION_HINTS: ReadonlySet<string> = new Set(USER_ACTION_HINTS);

function isRequestErrorCode(value: string): value is RequestErrorCode {
  return ERROR_CODES.has(value);
}

function isUserActionHint(value: string): value is UserActionHint {
  return ACTION_HINTS.has(value);
}

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
