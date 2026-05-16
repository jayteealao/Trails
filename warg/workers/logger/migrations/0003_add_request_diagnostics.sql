-- Add diagnostics fields used for fast dashboard triage
ALTER TABLE requests_index ADD COLUMN last_error_code TEXT;
ALTER TABLE requests_index ADD COLUMN last_error_message TEXT;
ALTER TABLE requests_index ADD COLUMN last_error_source TEXT;
ALTER TABLE requests_index ADD COLUMN retry_count INTEGER DEFAULT 0;
ALTER TABLE requests_index ADD COLUMN render_ms INTEGER;
ALTER TABLE requests_index ADD COLUMN derive_ms INTEGER;
ALTER TABLE requests_index ADD COLUMN persist_ms INTEGER;
ALTER TABLE requests_index ADD COLUMN last_trace_id TEXT;

CREATE INDEX IF NOT EXISTS idx_requests_error_code ON requests_index(last_error_code);
CREATE INDEX IF NOT EXISTS idx_requests_stage_created ON requests_index(stage, created_at DESC);
