CREATE TABLE IF NOT EXISTS underwriting_referrals (
  referral_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL,
  quote_id uuid REFERENCES quotes(quote_id) ON DELETE SET NULL,
  policy_id uuid REFERENCES policies(policy_id) ON DELETE CASCADE,
  transaction_id uuid REFERENCES policy_transactions(transaction_id) ON DELETE SET NULL,
  version_id uuid REFERENCES policy_versions(version_id) ON DELETE SET NULL,
  product_code text,
  agency_id uuid,
  insured_name text,
  effective_date date,
  transaction_type text NOT NULL,
  status text NOT NULL DEFAULT 'Open',
  priority text NOT NULL DEFAULT 'Normal',
  reasons text[] DEFAULT ARRAY[]::text[],
  assigned_to uuid,
  comments jsonb NOT NULL DEFAULT '[]'::jsonb,
  decision text,
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT underwriting_referrals_status_check
    CHECK (status IN ('Open', 'Approved', 'Declined', 'InfoRequested', 'Withdrawn')),
  CONSTRAINT underwriting_referrals_priority_check
    CHECK (priority IN ('Low', 'Normal', 'High', 'Urgent'))
);

CREATE INDEX IF NOT EXISTS idx_underwriting_referrals_tenant_status
  ON underwriting_referrals (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_underwriting_referrals_quote
  ON underwriting_referrals (tenant_id, quote_id);
CREATE INDEX IF NOT EXISTS idx_underwriting_referrals_policy
  ON underwriting_referrals (tenant_id, policy_id);

ALTER TABLE underwriting_referrals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS underwriting_referrals_tenant_isolation ON underwriting_referrals;
CREATE POLICY underwriting_referrals_tenant_isolation ON underwriting_referrals
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
