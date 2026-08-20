-- Data migration / legacy book import framework (issue #67).
-- Generic staging model: a batch of raw legacy rows is staged, validated,
-- reviewed, and committed. Only the "customer" entity type has a wired
-- commit handler in this slice (reusing the existing customer create/update
-- logic); other entity types can stage and validate rows using the same
-- tables but do not yet have a commit handler.

CREATE TABLE IF NOT EXISTS import_batches (
  batch_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL,
  entity_type text NOT NULL,
  source_system text NOT NULL,
  status text NOT NULL DEFAULT 'Staged',
  row_count int NOT NULL DEFAULT 0,
  valid_count int NOT NULL DEFAULT 0,
  invalid_count int NOT NULL DEFAULT 0,
  committed_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  notes text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_batches_status_check
    CHECK (status IN ('Staged', 'Validating', 'Validated', 'Committing', 'Committed', 'PartiallyCommitted', 'Failed'))
);

CREATE INDEX IF NOT EXISTS idx_import_batches_tenant_status
  ON import_batches (tenant_id, status, created_at DESC);

ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS import_batches_tenant_isolation ON import_batches;
CREATE POLICY import_batches_tenant_isolation ON import_batches
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE IF NOT EXISTS import_rows (
  row_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL,
  batch_id uuid NOT NULL REFERENCES import_batches(batch_id) ON DELETE CASCADE,
  row_number int NOT NULL,
  external_id text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'Pending',
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  committed_entity_type text,
  committed_entity_id uuid,
  commit_mode text,
  error_message text,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_rows_status_check
    CHECK (status IN ('Pending', 'Valid', 'Invalid', 'Committed', 'Failed', 'Skipped'))
);

CREATE INDEX IF NOT EXISTS idx_import_rows_batch ON import_rows (tenant_id, batch_id, status);
CREATE INDEX IF NOT EXISTS idx_import_rows_external ON import_rows (tenant_id, batch_id, external_id);

ALTER TABLE import_rows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS import_rows_tenant_isolation ON import_rows;
CREATE POLICY import_rows_tenant_isolation ON import_rows
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- Authoritative reconciliation ledger: prevents the same legacy record from
-- being committed twice across different batches, and lets operators trace a
-- committed platform entity back to its legacy source.
CREATE TABLE IF NOT EXISTS import_external_refs (
  tenant_id text NOT NULL,
  entity_type text NOT NULL,
  source_system text NOT NULL,
  external_id text NOT NULL,
  committed_entity_type text NOT NULL,
  committed_entity_id uuid NOT NULL,
  batch_id uuid NOT NULL REFERENCES import_batches(batch_id) ON DELETE CASCADE,
  row_id uuid NOT NULL REFERENCES import_rows(row_id) ON DELETE CASCADE,
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, entity_type, source_system, external_id)
);

ALTER TABLE import_external_refs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS import_external_refs_tenant_isolation ON import_external_refs;
CREATE POLICY import_external_refs_tenant_isolation ON import_external_refs
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
