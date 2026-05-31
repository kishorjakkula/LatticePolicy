BEGIN;

CREATE TABLE IF NOT EXISTS forms_admin_template_assets (
  asset_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES forms_admin_forms(form_id) ON DELETE CASCADE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL,
  content bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_forms_admin_template_assets_form
  ON forms_admin_template_assets(tenant_id, form_id);

CREATE INDEX IF NOT EXISTS idx_forms_admin_template_assets_tenant
  ON forms_admin_template_assets(tenant_id, updated_at DESC);

ALTER TABLE forms_admin_template_assets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_policies
     WHERE schemaname = current_schema()
       AND tablename = 'forms_admin_template_assets'
       AND policyname = 'tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON forms_admin_template_assets USING (tenant_id = current_setting(''app.tenant_id''))';
  END IF;
END $$;

COMMIT;
