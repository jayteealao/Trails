-- D1 schema for global requests index
-- Used for cross-request queries (list by domain, recent requests, etc.)

CREATE TABLE IF NOT EXISTS requests_index (
  request_id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  domain TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_event_ts TEXT,
  terminal_state INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  stage TEXT,
  manifest_r2_key TEXT,
  firestore_doc_id TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  last_error_source TEXT,
  retry_count INTEGER DEFAULT 0,
  render_ms INTEGER,
  derive_ms INTEGER,
  persist_ms INTEGER,
  last_trace_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_requests_domain ON requests_index(domain);
CREATE INDEX IF NOT EXISTS idx_requests_created ON requests_index(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_terminal ON requests_index(terminal_state);
CREATE INDEX IF NOT EXISTS idx_requests_error_code ON requests_index(last_error_code);
CREATE INDEX IF NOT EXISTS idx_requests_stage_created ON requests_index(stage, created_at DESC);
