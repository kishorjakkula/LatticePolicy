BEGIN;

ALTER TABLE agencies
  ADD COLUMN IF NOT EXISTS commission_rate numeric(10,4);

COMMIT;
