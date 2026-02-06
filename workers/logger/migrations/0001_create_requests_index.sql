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
  firestore_doc_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_requests_domain ON requests_index(domain);
CREATE INDEX IF NOT EXISTS idx_requests_created ON requests_index(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_terminal ON requests_index(terminal_state);
