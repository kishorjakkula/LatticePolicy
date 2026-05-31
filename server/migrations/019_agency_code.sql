BEGIN;

ALTER TABLE agencies
  ADD COLUMN IF NOT EXISTS agency_code text;

WITH ranked AS (
  SELECT
    agency_id,
    tenant_id,
    row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, agency_id) AS rn
  FROM agencies
  WHERE coalesce(trim(agency_code), '') = ''
)
UPDATE agencies a
SET agency_code = 'AG' || lpad(r.rn::text, 4, '0')
FROM ranked r
WHERE a.agency_id = r.agency_id;

ALTER TABLE agencies
  ALTER COLUMN agency_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_agencies_tenant_agency_code
  ON agencies(tenant_id, agency_code);

CREATE TABLE IF NOT EXISTS onboarding_agency_code_sequences (
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  code_prefix text NOT NULL,
  last_value bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, code_prefix)
);

ALTER TABLE onboarding_agency_code_sequences ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = current_schema()
      AND tablename = 'onboarding_agency_code_sequences'
      AND policyname = 'tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON onboarding_agency_code_sequences USING (tenant_id = current_setting(''app.tenant_id''))';
  END IF;
END $$;

COMMIT;
