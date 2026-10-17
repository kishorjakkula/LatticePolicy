BEGIN;

-- After migration 061 creates submission_fields, add numeric confidence (0-100).
-- The confidence label
-- (high, medium, low) is derived from it: high >= 85, medium >= 60, low below.
-- Null for values that were not found or where documents disagree.
ALTER TABLE submission_fields ADD COLUMN IF NOT EXISTS confidence_score integer;
ALTER TABLE submission_fields DROP CONSTRAINT IF EXISTS submission_fields_confidence_score_range;
ALTER TABLE submission_fields ADD CONSTRAINT submission_fields_confidence_score_range
  CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100));

COMMIT;
