BEGIN;

ALTER TABLE agencies
  ADD COLUMN IF NOT EXISTS parent_agency_id uuid;

CREATE INDEX IF NOT EXISTS idx_agencies_tenant_parent
  ON agencies(tenant_id, parent_agency_id)
  WHERE parent_agency_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_agencies_parent_agency'
  ) THEN
    ALTER TABLE agencies
      ADD CONSTRAINT fk_agencies_parent_agency
      FOREIGN KEY (tenant_id, parent_agency_id)
      REFERENCES agencies(tenant_id, agency_id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_agencies_parent_not_self'
  ) THEN
    ALTER TABLE agencies
      ADD CONSTRAINT chk_agencies_parent_not_self
      CHECK (parent_agency_id IS NULL OR parent_agency_id <> agency_id);
  END IF;
END $$;

COMMIT;
