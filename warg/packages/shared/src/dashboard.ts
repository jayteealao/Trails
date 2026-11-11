export const USER_ACTION_HINTS = [
  'retry_missing',
  'retry_step',
  'retry_full',
  'check_access',
  'check_api_key',
  'inspect_url',
  'investigate_service',
  'none',
] as const;

export type UserActionHint = (typeof USER_ACTION_HINTS)[number];

export function isUserActionHint(value: unknown): value is UserActionHint {
  return USER_ACTION_HINTS.some((hint) => hint === value);
}

export const REQUEST_ERROR_CODES = [
  'INVALID_INPUT_URL',
  'WORKFLOW_TRIGGER_FAILED',
  'NO_OUTPUTS_PRODUCED',
  'RENDER_TIMEOUT',
  'RENDER_SERVICE_ERROR',
  'RENDER_NETWORK_CLOSED',
  'RENDER_CONTEXT_DESTROYED',
  'RENDER_PREREQ_MISSING',
  'SINGLEFILE_TIMEOUT',
  'SINGLEFILE_SERVICE_ERROR',
  'SINGLEFILE_EDGE_CASE',
  'READABILITY_TIMEOUT',
  'READABILITY_SERVICE_ERROR',
  'AI_MARKDOWN_TIMEOUT',
  'AI_MARKDOWN_SERVICE_ERROR',
  'MONOLITH_TIMEOUT',
  'MONOLITH_SERVICE_ERROR',
  'MONOLITH_SANDBOX_500',
  'MONOLITH_RPC_32MIB_LIMIT',
  'MONOLITH_INPUT_TOO_LARGE',
  'MONOLITH_R2_HANDLER_FAILED',
  'MONOLITH_CONTAINER_UNAVAILABLE',
  'PERSIST_SERVICE_ERROR',
  'ACCESS_BLOCKED',
  'R2_CREDENTIAL_INVALID',
  'BROWSER_TOKEN_INVALID',
  'UNKNOWN_ERROR',
] as const;

export type RequestErrorCode = (typeof REQUEST_ERROR_CODES)[number];

export function isRequestErrorCode(value: unknown): value is RequestErrorCode {
  return REQUEST_ERROR_CODES.some((code) => code === value);
}

/** The codes of a rejected credential. */
export type CredentialErrorCode = 'R2_CREDENTIAL_INVALID' | 'BROWSER_TOKEN_INVALID';

/**
 * S3 error names that mean R2 refused the storage key itself. Matched without
 * case, because classifiers read lowercased messages.
 */
export const R2_KEY_ERROR_NAMES: readonly string[] = ['SignatureDoesNotMatch', 'InvalidAccessKeyId'];

export function isCredentialErrorCode(code: RequestErrorCode): code is CredentialErrorCode {
  return code === 'R2_CREDENTIAL_INVALID' || code === 'BROWSER_TOKEN_INVALID';
}

/** How every classifier reports a rejected credential: a retry cannot fix it; the owner replaces the key. */
export function credentialFailure(errorCode: CredentialErrorCode): {
  errorCode: CredentialErrorCode;
  retryable: false;
  recommendedAction: 'check_api_key';
} {
  return { errorCode, retryable: false, recommendedAction: 'check_api_key' };
}

/** The stealth settings a fallback render session can use. `none` is the default: stealth is an opt-in. */
export const RENDER_STEALTH_MODES = ['none', 'auto', 'ultra'] as const;

/** The stealth setting of a fallback render session. */
export type RenderStealthMode = (typeof RENDER_STEALTH_MODES)[number];

export function isRenderStealthMode(value: unknown): value is RenderStealthMode {
  return typeof value === 'string' && (RENDER_STEALTH_MODES as readonly string[]).includes(value);
}

export interface RequestDiagnostics {
  errorCode?: RequestErrorCode;
  errorMessage?: string;
  errorSource?: string;
  retryable?: boolean;
  recommendedAction?: UserActionHint;
  retryCount: number;
  renderMs?: number;
  deriveMs?: number;
  persistMs?: number;
  lastTraceId?: string;
  renderProvider?: 'browser-rendering' | 'hyperbrowser' | 'unknown';
  renderFallbackUsed?: boolean;
  renderFallbackReason?: string;
  /** The stealth setting the fallback renderer used. */
  renderFallbackStealth?: RenderStealthMode;
  degraded?: boolean;
  degradedSteps?: string[];
}

export interface ArticleHealth {
  completenessScore: number;
  missingCore: string[];
  failedArchives: string[];
  bestAvailableArchive: 'markdown' | 'readability' | 'singlefile' | 'rendered' | null;
  recommendedAction: UserActionHint;
}
