BEGIN;

CREATE TABLE underwriting_authority_grants (
  grant_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  subject_type text NOT NULL CHECK (subject_type IN ('USER','ROLE','PRODUCER')),
  subject_id text NOT NULL,
  product_code text,
  state_code char(2),
  transaction_types text[] NOT NULL,
  max_premium numeric(14,2),
  max_limit numeric(14,2),
  may_override boolean NOT NULL DEFAULT false,
  effective_date date NOT NULL,
  expiration_date date,
  active boolean NOT NULL DEFAULT true,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expiration_date IS NULL OR expiration_date >= effective_date)
);

CREATE TABLE underwriting_authority_audit (
  audit_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  grant_id uuid REFERENCES underwriting_authority_grants(grant_id) ON DELETE SET NULL,
  action text NOT NULL,
  actor text NOT NULL,
  before_value jsonb,
  after_value jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_uw_authority_lookup ON underwriting_authority_grants
  (tenant_id, subject_type, subject_id, effective_date DESC);
ALTER TABLE underwriting_authority_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE underwriting_authority_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON underwriting_authority_grants USING (tenant_id=current_setting('app.tenant_id'));
CREATE POLICY tenant_isolation ON underwriting_authority_audit USING (tenant_id=current_setting('app.tenant_id'));

COMMIT;
