-- Add render fallback/degraded diagnostics fields used for request list triage
ALTER TABLE requests_index ADD COLUMN render_provider TEXT;
ALTER TABLE requests_index ADD COLUMN render_fallback_used INTEGER DEFAULT 0;
ALTER TABLE requests_index ADD COLUMN render_fallback_reason TEXT;
ALTER TABLE requests_index ADD COLUMN degraded INTEGER DEFAULT 0;
ALTER TABLE requests_index ADD COLUMN degraded_steps TEXT;

CREATE INDEX IF NOT EXISTS idx_requests_render_fallback ON requests_index(render_fallback_used);
