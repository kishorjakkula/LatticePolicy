BEGIN;

CREATE TABLE servicing_compliance_rules (
  rule_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  product_code text NOT NULL,
  state_code char(2) NOT NULL,
  transaction_type text NOT NULL CHECK (transaction_type IN ('CANCEL','NON_RENEWAL')),
  allowed_reason_codes text[] NOT NULL,
  minimum_notice_days integer NOT NULL DEFAULT 0 CHECK (minimum_notice_days >= 0),
  maximum_notice_days integer CHECK (maximum_notice_days IS NULL OR maximum_notice_days >= minimum_notice_days),
  return_premium_method text CHECK (return_premium_method IN ('PRO_RATA','SHORT_RATE','FLAT','NONE')),
  required_form_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  required_delivery_methods text[] NOT NULL DEFAULT ARRAY['EMAIL']::text[],
  effective_date date NOT NULL,
  expiration_date date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  CHECK (expiration_date IS NULL OR expiration_date >= effective_date)
);

CREATE INDEX idx_servicing_compliance_lookup ON servicing_compliance_rules
  (tenant_id, product_code, state_code, transaction_type, effective_date DESC);
ALTER TABLE servicing_compliance_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON servicing_compliance_rules
  USING (tenant_id = current_setting('app.tenant_id'));

ALTER TABLE notification_intents
  ADD COLUMN IF NOT EXISTS delivery_evidence jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
