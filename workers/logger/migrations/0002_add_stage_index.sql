-- Add index on stage column for status filtering
CREATE INDEX IF NOT EXISTS idx_requests_stage ON requests_index(stage);
