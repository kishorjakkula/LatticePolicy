BEGIN;

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS quote_number text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'Draft',
  ADD COLUMN IF NOT EXISTS progress_step int DEFAULT 1,
  ADD COLUMN IF NOT EXISTS converted_policy_id uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

UPDATE quotes
   SET status = COALESCE(status, 'Draft'),
       progress_step = COALESCE(progress_step, 1),
       updated_at = COALESCE(updated_at, created_at)
 WHERE true;

CREATE UNIQUE INDEX IF NOT EXISTS ux_quotes_tenant_number ON quotes(tenant_id, quote_number) WHERE quote_number IS NOT NULL;

COMMIT;
