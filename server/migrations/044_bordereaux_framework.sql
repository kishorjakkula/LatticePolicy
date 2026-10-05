-- Bordereaux generation and validation framework (issue #62).
--
-- Generates and validates operational bordereaux (risk, premium, transaction,
-- cancellation, correction/resubmission, claims-reference handoff) from
-- persisted policy transaction data. Billing/claim financial settlement stays
-- outside LatticePolicy; this only produces the reporting handoff.

BEGIN;

CREATE TABLE IF NOT EXISTS bordereaux_batches (
  batch_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  bordereau_type text NOT NULL,
  status text NOT NULL DEFAULT 'Generated',
  period_start date NOT NULL,
  period_end date NOT NULL,
  product_code text,
  program_name text,
  recipient_name text,
  treaty_id uuid REFERENCES reinsurance_treaties(treaty_id) ON DELETE SET NULL,
  version int NOT NULL DEFAULT 1,
  corrects_batch_id uuid REFERENCES bordereaux_batches(batch_id) ON DELETE SET NULL,
  row_count int NOT NULL DEFAULT 0,
  valid_row_count int NOT NULL DEFAULT 0,
  invalid_row_count int NOT NULL DEFAULT 0,
  generated_by uuid,
  generated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb,
  CONSTRAINT bordereaux_batches_type_check
    CHECK (bordereau_type IN ('RISK', 'PREMIUM', 'TRANSACTION', 'CANCELLATION', 'CORRECTION', 'CLAIMS_REFERENCE_HANDOFF')),
  CONSTRAINT bordereaux_batches_status_check
    CHECK (status IN ('Generated', 'Corrected', 'Superseded')),
  CONSTRAINT bordereaux_batches_period_check
    CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_bordereaux_batches_lookup
  ON bordereaux_batches (tenant_id, bordereau_type, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_bordereaux_batches_corrects
  ON bordereaux_batches (tenant_id, corrects_batch_id);

CREATE TABLE IF NOT EXISTS bordereaux_rows (
  row_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES bordereaux_batches(batch_id) ON DELETE CASCADE,
  row_number int NOT NULL,
  policy_id uuid REFERENCES policies(policy_id) ON DELETE SET NULL,
  transaction_id uuid REFERENCES policy_transactions(transaction_id) ON DELETE SET NULL,
  policy_number text,
  row_data jsonb NOT NULL,
  is_valid boolean NOT NULL DEFAULT true,
  validation_errors jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bordereaux_rows_unique_number UNIQUE (tenant_id, batch_id, row_number)
);

CREATE INDEX IF NOT EXISTS idx_bordereaux_rows_batch
  ON bordereaux_rows (tenant_id, batch_id, row_number);
CREATE INDEX IF NOT EXISTS idx_bordereaux_rows_policy
  ON bordereaux_rows (tenant_id, policy_id);

ALTER TABLE bordereaux_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE bordereaux_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bordereaux_batches_tenant_isolation ON bordereaux_batches;
CREATE POLICY bordereaux_batches_tenant_isolation ON bordereaux_batches
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS bordereaux_rows_tenant_isolation ON bordereaux_rows;
CREATE POLICY bordereaux_rows_tenant_isolation ON bordereaux_rows
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

COMMIT;
