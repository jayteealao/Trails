// ─── Request / Pipeline Types ───

export interface ArchiveRequest {
  requestId: string;
  url: string;
  domain: string;
  stage: Stage;
  errorCount: number;
  createdAt: string;
}

export type Stage = 'queued' | 'rendering' | 'deriving' | 'persisting' | 'done' | 'failed';

export interface RequestListResponse {
  requests: ArchiveRequest[];
  meta?: { count: number };
}

export interface RequestDetail {
  requestId: string;
  url: string;
  createdAt: string;
  derived?: { stage: Stage };
  events: PipelineEvent[];
  artifacts: Artifact[];
}

export interface PipelineEvent {
  type: string;
  source: string;
  message: string;
  level: 'info' | 'warn' | 'error';
  ts: string;
  data?: Record<string, unknown>;
}

export interface Artifact {
  kind: string;
  bytes?: number;
  contentType?: string;
  r2Key?: string;
}

// ─── Stats Types ───

export interface StatsResponse {
  total: number;
  successRate: number;
  activeCount: number;
  stuckCount: number;
  recentActivity: {
    last1h: number;
    last24h: number;
  };
  byStage: Record<string, number>;
  topDomains: { domain: string; count: number }[];
  recentFailures: {
    requestId: string;
    url: string;
    createdAt: string;
  }[];
}

// ─── Infra Types ───

export interface InfraResponse {
  workers: WorkerMetric[];
  d1: D1Metrics;
  r2: R2Metrics;
  durableObjects: DOMetrics;
  workflows: WorkflowsResult;
}

export interface WorkerMetric {
  scriptName: string;
  requests: number;
  errors: number;
  cpuP50: number | null;
  cpuP99: number | null;
}

export interface D1Metrics {
  queryCount: number;
  rowsRead: number;
  rowsWritten: number;
  databaseSize: number | null;
}

export interface R2Metrics {
  bucketSize: number | null;
  objectCount: number | null;
  operationCount: number;
}

export interface DOMetrics {
  storageBytes: number | null;
  requestCount: number;
}

export interface WorkflowsResult {
  statusCounts: Record<string, number>;
}

// ─── Backfill Types ───

export interface BackfillResponse {
  status: string;
  tracker?: BackfillTracker;
}

export interface BackfillTracker {
  last_run_result: string;
  batch_number: number;
  batch: BackfillBatchItem[];
  total_sent: number;
  total_completed: number;
  total_failed: number;
  consecutive_all_failed: number;
  last_run_at: FirestoreTimestamp | string;
  batch_started_at: FirestoreTimestamp | string;
}

export interface BackfillBatchItem {
  url: string;
  retry_count: number;
  sent_at: FirestoreTimestamp | string;
}

export interface FirestoreTimestamp {
  _seconds: number;
}

// ─── Article Types ───

export interface Article {
  item_id: string;
  url: string;
  title?: string;
  domain: string;
  archive_classification: string;
  archives: ArchiveEntry[];
  has_canonical: boolean;
  created_at: string;
  warg_request_id?: string;
  firestore_status?: string;
  error?: string;
  metadata?: ArticleMetadata;
}

export interface ArchiveEntry {
  key: string;
  status: 'success' | 'pending' | 'failed' | 'absent';
  compressed_size?: number;
  created_at?: string;
}

export interface ArticleMetadata {
  byline?: string;
  excerpt?: string;
  word_count?: number;
  site_name?: string;
  published_time?: string;
}

export interface ArticleListResponse {
  articles: Article[];
  total: number;
  hasMore: boolean;
}

// ─── Archive Submission ───

export interface ArchiveSubmitRequest {
  url: string;
  request_id?: string;
  steps?: string[];
}

export interface ArchiveSubmitResponse {
  requestId?: string;
  request_id?: string;
}

// ─── Signed URL ───

export interface SignedUrlResponse {
  url: string;
}
