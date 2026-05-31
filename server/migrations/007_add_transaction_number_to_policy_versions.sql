BEGIN;

ALTER TABLE policy_versions
  ADD COLUMN IF NOT EXISTS transaction_number text;

COMMIT;
