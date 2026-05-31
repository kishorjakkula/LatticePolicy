BEGIN;

ALTER TABLE policy_transactions
  ADD COLUMN IF NOT EXISTS effective_date date,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS sequence_no int,
  ADD COLUMN IF NOT EXISTS base_timeline_version int,
  ADD COLUMN IF NOT EXISTS timeline_version int;

UPDATE policy_transactions
SET processed_at = COALESCE(processed_at, updated_at, created_at, now())
WHERE processed_at IS NULL;

UPDATE policy_transactions
SET effective_date = COALESCE(
  effective_date,
  NULLIF(term ->> 'effectiveDate', '')::date,
  NULLIF(term ->> 'cancelDate', '')::date,
  NULLIF(term ->> 'reinstateDate', '')::date,
  NULLIF(term ->> 'rewriteDate', '')::date,
  NULLIF(term ->> 'renewDate', '')::date
)
WHERE effective_date IS NULL;

WITH ranked AS (
  SELECT transaction_id,
         row_number() OVER (
           PARTITION BY tenant_id, policy_id
           ORDER BY COALESCE(processed_at, created_at), created_at, transaction_id
         )::int AS next_sequence
  FROM policy_transactions
)
UPDATE policy_transactions pt
SET sequence_no = ranked.next_sequence
FROM ranked
WHERE pt.transaction_id = ranked.transaction_id
  AND pt.sequence_no IS NULL;

CREATE INDEX IF NOT EXISTS idx_policy_transactions_effective_date
  ON policy_transactions(tenant_id, policy_id, effective_date, sequence_no);
CREATE INDEX IF NOT EXISTS idx_policy_transactions_timeline_version
  ON policy_transactions(tenant_id, policy_id, timeline_version);

ALTER TABLE policy_versions
  ADD COLUMN IF NOT EXISTS base_timeline_version int,
  ADD COLUMN IF NOT EXISTS timeline_version int;

CREATE INDEX IF NOT EXISTS idx_policy_versions_effective_date
  ON policy_versions(tenant_id, policy_id, effective_date, processed_at);
CREATE INDEX IF NOT EXISTS idx_policy_versions_timeline_version
  ON policy_versions(tenant_id, policy_id, timeline_version);

CREATE TABLE IF NOT EXISTS policy_timeline_segments (
  segment_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES policies(policy_id) ON DELETE CASCADE,
  timeline_version int NOT NULL,
  segment_start date NOT NULL,
  segment_end date NOT NULL,
  source_version_id uuid REFERENCES policy_versions(version_id) ON DELETE SET NULL,
  source_transaction_id uuid REFERENCES policy_transactions(transaction_id) ON DELETE SET NULL,
  payload jsonb,
  premium_total numeric(14,2) NOT NULL DEFAULT 0,
  premium_fees numeric(14,2) NOT NULL DEFAULT 0,
  premium_taxes numeric(14,2) NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'USD',
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_policy_timeline_segments_window
  ON policy_timeline_segments(tenant_id, policy_id, timeline_version, segment_start);
CREATE INDEX IF NOT EXISTS idx_policy_timeline_segments_lookup
  ON policy_timeline_segments(tenant_id, policy_id, segment_start, segment_end);

CREATE TABLE IF NOT EXISTS policy_retro_adjustments (
  adjustment_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES policies(policy_id) ON DELETE CASCADE,
  transaction_id uuid REFERENCES policy_transactions(transaction_id) ON DELETE SET NULL,
  timeline_version int NOT NULL,
  from_date date NOT NULL,
  to_date date NOT NULL,
  amount_total numeric(14,2) NOT NULL DEFAULT 0,
  amount_fees numeric(14,2) NOT NULL DEFAULT 0,
  amount_taxes numeric(14,2) NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'USD',
  reason text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_policy_retro_adjustments_lookup
  ON policy_retro_adjustments(tenant_id, policy_id, timeline_version, created_at DESC);

ALTER TABLE policy_timeline_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_retro_adjustments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = current_schema()
      AND tablename = 'policy_timeline_segments'
      AND policyname = 'tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON policy_timeline_segments USING (tenant_id = current_setting(''app.tenant_id''))';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = current_schema()
      AND tablename = 'policy_retro_adjustments'
      AND policyname = 'tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON policy_retro_adjustments USING (tenant_id = current_setting(''app.tenant_id''))';
  END IF;
END $$;

COMMIT;
