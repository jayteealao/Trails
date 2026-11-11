import { generateRequestId, isValidRequestId, withRequestId } from './util.js';

/**
 * The one list of codes a gateway error response can carry. Each value equals its key.
 */
export const GATEWAY_ERROR_CODES = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_JSON: 'INVALID_JSON',
  INVALID_REQUEST_ID: 'INVALID_REQUEST_ID',
  INVALID_INPUT_URL: 'INVALID_INPUT_URL',
  REQUEST_ID_REQUIRED: 'REQUEST_ID_REQUIRED',
  REQUEST_NOT_FOUND: 'REQUEST_NOT_FOUND',
  STATUS_LOOKUP_FAILED: 'STATUS_LOOKUP_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  WORKFLOW_TRIGGER_FAILED: 'WORKFLOW_TRIGGER_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  INVALID_OPTIONS: 'INVALID_OPTIONS',
  OPTION_NOT_ALLOWED: 'OPTION_NOT_ALLOWED',
  REQUEST_ID_CONFLICT: 'REQUEST_ID_CONFLICT'
} as const;

/**
 * A code from GATEWAY_ERROR_CODES.
 */
export type GatewayErrorCode = (typeof GATEWAY_ERROR_CODES)[keyof typeof GATEWAY_ERROR_CODES];

/**
 * The fixed message of every 500; the raw exception text goes to the server log only.
 */
export const INTERNAL_ERROR_MESSAGE = 'Internal error';

/**
 * The id of an error response: the candidate when it is a valid request id,
 * otherwise a fresh correlation id. An invalid caller-supplied id is never echoed.
 */
export function errorIdFor(candidate: string | undefined): string {
  return candidate !== undefined && isValidRequestId(candidate) ? candidate : generateRequestId();
}

/**
 * Build an error response `{ ...extra, error, code, id }` with the id also in X-Request-Id.
 * `extra` is spread first, so it can never override error, code or id.
 *
 * A refusal (4xx) is logged here with its id, so an id a caller quotes always
 * matches a log line; pass `logged: true` when the caller has logged it already.
 * A 5xx is logged by its handler, with the error.
 */
export function errorResponse(
  status: number,
  code: GatewayErrorCode,
  message: string,
  id: string,
  extra: Record<string, unknown> = {},
  { logged = false }: { logged?: boolean } = {}
): Response {
  if (!logged && status >= 400 && status < 500) {
    console.warn('[gateway] refused', { id, status, code });
  }
  return withRequestId(Response.json({ ...extra, error: message, code, id }, { status }), id);
}
