ALTER TABLE idempotency_keys
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed';

ALTER TABLE idempotency_keys
  ALTER COLUMN status_code DROP NOT NULL;

ALTER TABLE idempotency_keys
  ALTER COLUMN response_body DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'idempotency_keys_status_check'
  ) THEN
    ALTER TABLE idempotency_keys
      ADD CONSTRAINT idempotency_keys_status_check
      CHECK (status IN ('processing', 'completed', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_tenant_status
  ON idempotency_keys (tenant_id, status);
