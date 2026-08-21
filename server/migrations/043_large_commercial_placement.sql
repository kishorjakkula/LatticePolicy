-- Large commercial and reinsurance-style placement/subscription workflow (issue #64).
-- Additive: the existing single-carrier quote/bind flow is unaffected. A
-- placement optionally references a quote (pre-bind) and, once bound, the
-- resulting policy, so it can coexist with or lead into the standard
-- quote-to-policy lifecycle.

CREATE TABLE IF NOT EXISTS commercial_placements (
  placement_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL,
  quote_id uuid REFERENCES quotes(quote_id) ON DELETE SET NULL,
  policy_id uuid REFERENCES policies(policy_id) ON DELETE SET NULL,
  product_code text,
  insured_name text NOT NULL,
  effective_date date,
  facility_reference text,
  status text NOT NULL DEFAULT 'Submission',
  terms jsonb NOT NULL DEFAULT '[]'::jsonb,
  documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  status_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commercial_placements_status_check
    CHECK (status IN ('Submission', 'Indication', 'Quoted', 'BindOrder', 'Bound', 'Issued', 'Declined', 'Withdrawn'))
);

CREATE INDEX IF NOT EXISTS idx_commercial_placements_tenant_status
  ON commercial_placements (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_commercial_placements_quote
  ON commercial_placements (tenant_id, quote_id);
CREATE INDEX IF NOT EXISTS idx_commercial_placements_policy
  ON commercial_placements (tenant_id, policy_id);

ALTER TABLE commercial_placements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commercial_placements_tenant_isolation ON commercial_placements;
CREATE POLICY commercial_placements_tenant_isolation ON commercial_placements
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE IF NOT EXISTS placement_market_participants (
  participant_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL,
  placement_id uuid NOT NULL REFERENCES commercial_placements(placement_id) ON DELETE CASCADE,
  market_name text NOT NULL,
  role text NOT NULL DEFAULT 'Following',
  subscription_percent numeric(5, 2) NOT NULL,
  security_status text NOT NULL DEFAULT 'Provisional',
  broker_intermediary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT placement_market_participants_role_check
    CHECK (role IN ('Lead', 'Following')),
  CONSTRAINT placement_market_participants_security_status_check
    CHECK (security_status IN ('Provisional', 'Confirmed', 'Withdrawn')),
  CONSTRAINT placement_market_participants_share_check
    CHECK (subscription_percent > 0 AND subscription_percent <= 100)
);

CREATE INDEX IF NOT EXISTS idx_placement_participants_placement
  ON placement_market_participants (tenant_id, placement_id);

ALTER TABLE placement_market_participants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS placement_market_participants_tenant_isolation ON placement_market_participants;
CREATE POLICY placement_market_participants_tenant_isolation ON placement_market_participants
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE IF NOT EXISTS placement_subjectivities (
  subjectivity_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL,
  placement_id uuid NOT NULL REFERENCES commercial_placements(placement_id) ON DELETE CASCADE,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'Open',
  due_date date,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT placement_subjectivities_status_check
    CHECK (status IN ('Open', 'Satisfied', 'Waived'))
);

CREATE INDEX IF NOT EXISTS idx_placement_subjectivities_placement
  ON placement_subjectivities (tenant_id, placement_id);

ALTER TABLE placement_subjectivities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS placement_subjectivities_tenant_isolation ON placement_subjectivities;
CREATE POLICY placement_subjectivities_tenant_isolation ON placement_subjectivities
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
