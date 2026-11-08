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
  'MONOLITH_TIMEOUT',
  'MONOLITH_SERVICE_ERROR',
  'MONOLITH_SANDBOX_500',
  'MONOLITH_RPC_32MIB_LIMIT',
  'MONOLITH_INPUT_TOO_LARGE',
  'PERSIST_SERVICE_ERROR',
  'ACCESS_BLOCKED',
  'UNKNOWN_ERROR',
] as const;

export type RequestErrorCode = (typeof REQUEST_ERROR_CODES)[number];

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
