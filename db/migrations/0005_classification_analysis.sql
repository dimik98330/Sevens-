-- Additive metadata; historical routing rows remain unchanged and readable.
ALTER TABLE routing_decisions ADD COLUMN IF NOT EXISTS analysis_json JSONB;
ALTER TABLE routing_decisions ADD CONSTRAINT routing_analysis_object
  CHECK (analysis_json IS NULL OR jsonb_typeof(analysis_json) = 'object');
