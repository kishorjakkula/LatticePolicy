-- Reinsurance treaty and facultative placement model (issue #61).
--
-- Represents treaty/facultative reinsurance arrangements and links policy
-- transactions to the arrangement(s) that apply, with retained/ceded
-- metadata for downstream handoff. No settlement/accounting calculation
-- lives here — see docs/REINSURANCE_MODEL.md for the explicit boundary.

BEGIN;

CREATE TABLE IF NOT EXISTS reinsurance_programs (
  program_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  program_name text NOT NULL,
  program_year int,
  status text NOT NULL DEFAULT 'Active',
  notes text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reinsurance_programs_status_check
    CHECK (status IN ('Draft', 'Active', 'Expired', 'Cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_reinsurance_programs_tenant
  ON reinsurance_programs (tenant_id, status);

CREATE TABLE IF NOT EXISTS reinsurance_treaties (
  treaty_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  program_id uuid REFERENCES reinsurance_programs(program_id) ON DELETE CASCADE,
  treaty_name text NOT NULL,
  treaty_type text NOT NULL,
  status text NOT NULL DEFAULT 'Active',
  effective_date date NOT NULL,
  expiration_date date NOT NULL,
  version int NOT NULL DEFAULT 1,
  superseded_by uuid REFERENCES reinsurance_treaties(treaty_id) ON DELETE SET NULL,
  broker_name text,
  broker_reference text,
  currency char(3) NOT NULL DEFAULT 'USD',
  product_codes text[],
  state_codes text[],
  metadata jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reinsurance_treaties_status_check
    CHECK (status IN ('Draft', 'Active', 'Expired', 'Cancelled')),
  CONSTRAINT reinsurance_treaties_type_check
    CHECK (treaty_type IN ('QUOTA_SHARE', 'SURPLUS', 'EXCESS_OF_LOSS', 'FACULTATIVE_OBLIGATORY')),
  CONSTRAINT reinsurance_treaties_dates_check
    CHECK (expiration_date > effective_date)
);

CREATE INDEX IF NOT EXISTS idx_reinsurance_treaties_lookup
  ON reinsurance_treaties (tenant_id, status, effective_date, expiration_date);
CREATE INDEX IF NOT EXISTS idx_reinsurance_treaties_program
  ON reinsurance_treaties (tenant_id, program_id);

CREATE TABLE IF NOT EXISTS reinsurance_treaty_layers (
  layer_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  treaty_id uuid NOT NULL REFERENCES reinsurance_treaties(treaty_id) ON DELETE CASCADE,
  layer_number int NOT NULL DEFAULT 1,
  layer_type text,
  retention_amount numeric(14, 2),
  limit_amount numeric(14, 2),
  ceded_percent numeric(6, 3) NOT NULL,
  retained_percent numeric(6, 3) NOT NULL,
  premium_rate numeric(8, 5),
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reinsurance_treaty_layers_ceded_check
    CHECK (ceded_percent >= 0 AND ceded_percent <= 100),
  CONSTRAINT reinsurance_treaty_layers_retained_check
    CHECK (retained_percent >= 0 AND retained_percent <= 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_reinsurance_treaty_layers_number
  ON reinsurance_treaty_layers (tenant_id, treaty_id, layer_number);

CREATE TABLE IF NOT EXISTS reinsurance_facultative_certificates (
  certificate_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES policies(policy_id) ON DELETE CASCADE,
  certificate_number text,
  status text NOT NULL DEFAULT 'Active',
  effective_date date NOT NULL,
  expiration_date date NOT NULL,
  retention_amount numeric(14, 2),
  limit_amount numeric(14, 2),
  ceded_percent numeric(6, 3) NOT NULL,
  retained_percent numeric(6, 3) NOT NULL,
  broker_name text,
  metadata jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reinsurance_fac_certs_status_check
    CHECK (status IN ('Draft', 'Active', 'Expired', 'Cancelled')),
  CONSTRAINT reinsurance_fac_certs_ceded_check
    CHECK (ceded_percent >= 0 AND ceded_percent <= 100),
  CONSTRAINT reinsurance_fac_certs_retained_check
    CHECK (retained_percent >= 0 AND retained_percent <= 100),
  CONSTRAINT reinsurance_fac_certs_dates_check
    CHECK (expiration_date > effective_date)
);

CREATE INDEX IF NOT EXISTS idx_reinsurance_fac_certs_policy
  ON reinsurance_facultative_certificates (tenant_id, policy_id, status);

CREATE TABLE IF NOT EXISTS reinsurance_market_participants (
  participant_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  layer_id uuid REFERENCES reinsurance_treaty_layers(layer_id) ON DELETE CASCADE,
  facultative_certificate_id uuid REFERENCES reinsurance_facultative_certificates(certificate_id) ON DELETE CASCADE,
  reinsurer_name text NOT NULL,
  reinsurer_reference text,
  participation_percent numeric(6, 3) NOT NULL,
  broker_name text,
  is_lead boolean NOT NULL DEFAULT false,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reinsurance_market_participants_percent_check
    CHECK (participation_percent > 0 AND participation_percent <= 100),
  CONSTRAINT reinsurance_market_participants_one_parent_check
    CHECK (
      (layer_id IS NOT NULL AND facultative_certificate_id IS NULL) OR
      (layer_id IS NULL AND facultative_certificate_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_reinsurance_market_participants_layer
  ON reinsurance_market_participants (tenant_id, layer_id);
CREATE INDEX IF NOT EXISTS idx_reinsurance_market_participants_fac
  ON reinsurance_market_participants (tenant_id, facultative_certificate_id);

CREATE TABLE IF NOT EXISTS policy_reinsurance_placements (
  placement_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES policies(policy_id) ON DELETE CASCADE,
  transaction_id uuid REFERENCES policy_transactions(transaction_id) ON DELETE SET NULL,
  placement_type text NOT NULL,
  treaty_id uuid REFERENCES reinsurance_treaties(treaty_id) ON DELETE SET NULL,
  layer_id uuid REFERENCES reinsurance_treaty_layers(layer_id) ON DELETE SET NULL,
  facultative_certificate_id uuid REFERENCES reinsurance_facultative_certificates(certificate_id) ON DELETE SET NULL,
  retained_percent numeric(6, 3),
  ceded_percent numeric(6, 3),
  retained_premium numeric(14, 2),
  ceded_premium numeric(14, 2),
  basis jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb,
  CONSTRAINT policy_reinsurance_placements_type_check
    CHECK (placement_type IN ('TREATY', 'FACULTATIVE'))
);

CREATE INDEX IF NOT EXISTS idx_policy_reinsurance_placements_policy
  ON policy_reinsurance_placements (tenant_id, policy_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_policy_reinsurance_placements_transaction
  ON policy_reinsurance_placements (tenant_id, transaction_id);

ALTER TABLE reinsurance_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE reinsurance_treaties ENABLE ROW LEVEL SECURITY;
ALTER TABLE reinsurance_treaty_layers ENABLE ROW LEVEL SECURITY;
ALTER TABLE reinsurance_facultative_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE reinsurance_market_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_reinsurance_placements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reinsurance_programs_tenant_isolation ON reinsurance_programs;
CREATE POLICY reinsurance_programs_tenant_isolation ON reinsurance_programs
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS reinsurance_treaties_tenant_isolation ON reinsurance_treaties;
CREATE POLICY reinsurance_treaties_tenant_isolation ON reinsurance_treaties
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS reinsurance_treaty_layers_tenant_isolation ON reinsurance_treaty_layers;
CREATE POLICY reinsurance_treaty_layers_tenant_isolation ON reinsurance_treaty_layers
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS reinsurance_fac_certs_tenant_isolation ON reinsurance_facultative_certificates;
CREATE POLICY reinsurance_fac_certs_tenant_isolation ON reinsurance_facultative_certificates
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS reinsurance_market_participants_tenant_isolation ON reinsurance_market_participants;
CREATE POLICY reinsurance_market_participants_tenant_isolation ON reinsurance_market_participants
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS policy_reinsurance_placements_tenant_isolation ON policy_reinsurance_placements;
CREATE POLICY policy_reinsurance_placements_tenant_isolation ON policy_reinsurance_placements
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

COMMIT;
