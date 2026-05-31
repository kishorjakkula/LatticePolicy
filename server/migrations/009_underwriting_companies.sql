BEGIN;

CREATE TABLE IF NOT EXISTS underwriting_companies (
  company_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  name text NOT NULL,
  product_code text NOT NULL,
  country_code text NOT NULL,
  state_code text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_uw_companies_tenant_lookup
  ON underwriting_companies(tenant_id, product_code, country_code, state_code, active);

CREATE UNIQUE INDEX IF NOT EXISTS ux_uw_companies_unique
  ON underwriting_companies(tenant_id, name, product_code, country_code, state_code);

ALTER TABLE underwriting_companies ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = current_schema()
      AND tablename = 'underwriting_companies'
      AND policyname = 'tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON underwriting_companies USING (tenant_id = current_setting(''app.tenant_id''))';
  END IF;
END $$;

COMMIT;
