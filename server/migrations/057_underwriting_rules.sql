BEGIN;

-- Tenant-authored underwriting eligibility rules: a data-driven replacement
-- for the hand-coded per-product rule functions in uw.service.ts. Follows
-- the same "published/configured data takes over, hardcoded logic remains
-- the fallback" pattern as rating_model_versions (see
-- rating.service.ts's rateWithPublishedModelOrFallback), and the same
-- opt-in/additive/RLS-isolated structural pattern as
-- aggregation_appetite_limits (migrations/056_aggregation_appetite_limits.sql).
--
-- This table starts empty for every tenant, so adding it changes no existing
-- underwriting behavior until a tenant explicitly opts in by inserting rows
-- (via the admin CRUD routes or the idempotent seed action). It also fully
-- subsumes the one-off tenant config.yaml `overrides.underwriting.rules`
-- mechanism (e.g. the HO-ROOF-AGE override) -- that mechanism is removed
-- from uw.service.ts in the same change that introduces this table, and the
-- seed action migrates any such tenant's override into a real row here.
CREATE TABLE IF NOT EXISTS underwriting_rules (
  rule_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  product_code text NOT NULL,
  -- NULL = applies to all states (wildcard), matching the convention already
  -- used in underwriting_authority_grants and forms_admin_jurisdictions.
  state_code char(2),
  -- Dotted/bracketed path into the submission payload, e.g.
  -- 'uwAnswers.priorAtFaultAccidents' or 'risks[0].roofAgeYears'. Validated
  -- against the curated catalog in underwriting-rule-fields.ts for the
  -- rule's product_code at write time (see uw.routes.ts).
  field_path text NOT NULL,
  operator text NOT NULL,
  -- number | string | boolean | array, depending on the field's data type
  -- and the chosen operator (e.g. an array of strings for 'in'/'not_in').
  comparison_value jsonb NOT NULL,
  outcome text NOT NULL,
  reason_code text NOT NULL,
  reason_description text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  expiration_date date,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT underwriting_rules_outcome_ck CHECK (outcome IN ('Refer','Decline')),
  CONSTRAINT underwriting_rules_operator_ck CHECK (operator IN (
    'equals','not_equals','greater_than','greater_than_or_equal',
    'less_than','less_than_or_equal','is_true','is_false','in','not_in'
  )),
  CONSTRAINT underwriting_rules_expiration_ck CHECK (expiration_date IS NULL OR expiration_date >= effective_date)
);

CREATE INDEX IF NOT EXISTS idx_underwriting_rules_lookup
  ON underwriting_rules (tenant_id, product_code, state_code);

CREATE INDEX IF NOT EXISTS idx_underwriting_rules_active_window
  ON underwriting_rules (tenant_id, product_code, active, effective_date, expiration_date);

ALTER TABLE underwriting_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON underwriting_rules
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

COMMIT;
