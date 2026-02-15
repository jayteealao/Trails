export type UserActionHint =
  | 'retry_missing'
  | 'retry_step'
  | 'retry_full'
  | 'check_access'
  | 'check_api_key'
  | 'inspect_url'
  | 'investigate_service'
  | 'none';

export type RequestErrorCode =
  | 'INVALID_INPUT_URL'
  | 'WORKFLOW_TRIGGER_FAILED'
  | 'RENDER_TIMEOUT'
  | 'RENDER_SERVICE_ERROR'
  | 'SINGLEFILE_TIMEOUT'
  | 'SINGLEFILE_SERVICE_ERROR'
  | 'READABILITY_TIMEOUT'
  | 'READABILITY_SERVICE_ERROR'
  | 'MONOLITH_TIMEOUT'
  | 'MONOLITH_SERVICE_ERROR'
  | 'PERSIST_SERVICE_ERROR'
  | 'ACCESS_BLOCKED'
  | 'UNKNOWN_ERROR';

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
}

export interface ArticleHealth {
  completenessScore: number;
  missingCore: string[];
  failedArchives: string[];
  bestAvailableArchive: 'markdown' | 'readability' | 'singlefile' | 'rendered' | null;
  recommendedAction: UserActionHint;
}
