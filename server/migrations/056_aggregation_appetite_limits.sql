BEGIN;

-- Tenant-configurable, per-(product, state) aggregation/accumulation
-- appetite limits, checked at bind time by quote-bind.service.ts alongside
-- the existing underwriting-authority and UW-decision referral paths (see
-- underwriting_authority_grants in migrations/053_underwriting_authority.sql
-- for the sibling pattern this follows).
--
-- Unconfigured (no active row for a given tenant/product/state) means the
-- aggregation-appetite check is a complete no-op for that combination — this
-- table starts empty for every tenant, so adding it changes no existing
-- bind behavior until a tenant explicitly opts in by inserting a row.
CREATE TABLE IF NOT EXISTS aggregation_appetite_limits (
  limit_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  product_code text NOT NULL,
  state_code char(2) NOT NULL,
  -- Total insured value ceiling for the book, reusing exposure.service.ts's
  -- existing TIV dimension (sum of selected coverage limits per policy).
  max_total_tiv numeric(14,2),
  -- Policy-count ceiling for the book, as an alternative/additional
  -- dimension to TIV.
  max_policy_count integer,
  active boolean NOT NULL DEFAULT true,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aggregation_appetite_limits_has_limit_ck
    CHECK (max_total_tiv IS NOT NULL OR max_policy_count IS NOT NULL),
  CONSTRAINT aggregation_appetite_limits_max_total_tiv_ck
    CHECK (max_total_tiv IS NULL OR max_total_tiv > 0),
  CONSTRAINT aggregation_appetite_limits_max_policy_count_ck
    CHECK (max_policy_count IS NULL OR max_policy_count > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_aggregation_appetite_limits_active
  ON aggregation_appetite_limits (tenant_id, LOWER(product_code), UPPER(state_code))
  WHERE active;

CREATE INDEX IF NOT EXISTS idx_aggregation_appetite_limits_lookup
  ON aggregation_appetite_limits (tenant_id, product_code, state_code);

ALTER TABLE aggregation_appetite_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON aggregation_appetite_limits
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

COMMIT;
