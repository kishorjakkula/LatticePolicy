BEGIN;

ALTER TABLE coverage_selections
  ADD COLUMN IF NOT EXISTS percent numeric(12,4);

COMMIT;
