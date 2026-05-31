BEGIN;

CREATE TABLE IF NOT EXISTS rating_models (
  model_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  model_code text NOT NULL,
  product_code text NOT NULL,
  state_code text,
  program_name text,
  status text NOT NULL DEFAULT 'DRAFT',
  active_version_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  UNIQUE (tenant_id, model_code)
);

CREATE TABLE IF NOT EXISTS rating_model_versions (
  version_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES rating_models(model_id) ON DELETE CASCADE,
  version_label text NOT NULL,
  publish_status text NOT NULL DEFAULT 'DRAFT',
  is_active boolean NOT NULL DEFAULT false,
  parser_name text NOT NULL DEFAULT 'generic-rating-workbook',
  parser_version text NOT NULL DEFAULT '1.0.0',
  source_file_name text,
  source_mime_type text,
  workbook_sha256 text,
  effective_date date,
  expiration_date date,
  workbook_json jsonb NOT NULL,
  parser_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  published_at timestamptz,
  published_by text,
  UNIQUE (tenant_id, model_id, version_label)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'rating_models'
      AND constraint_name = 'fk_rating_models_active_version'
  ) THEN
    ALTER TABLE rating_models
      ADD CONSTRAINT fk_rating_models_active_version
      FOREIGN KEY (active_version_id)
      REFERENCES rating_model_versions(version_id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rating_models_product_state
  ON rating_models(tenant_id, product_code, COALESCE(state_code, ''), updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_rating_model_versions_lookup
  ON rating_model_versions(tenant_id, model_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rating_model_versions_active
  ON rating_model_versions(tenant_id, model_id, is_active, publish_status, effective_date DESC);

ALTER TABLE rating_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE rating_model_versions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = current_schema()
      AND tablename = 'rating_models'
      AND policyname = 'tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON rating_models USING (tenant_id = current_setting(''app.tenant_id''))';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = current_schema()
      AND tablename = 'rating_model_versions'
      AND policyname = 'tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON rating_model_versions USING (tenant_id = current_setting(''app.tenant_id''))';
  END IF;
END $$;

COMMIT;

