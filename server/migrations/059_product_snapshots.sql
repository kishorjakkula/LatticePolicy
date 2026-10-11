BEGIN;

-- The product definition a policy term was written on.
--
-- A carrier changes its products over time (rate tables, coverages, screen
-- rules), by loading a new carrier pack, publishing a rating workbook, or
-- taking a release. Those changes apply to new business and renewals. A
-- policy already in force has to keep being rated and checked against the
-- definition it was written on, so a mid-term endorsement does not silently
-- pick up new rates.
--
-- Each distinct definition is stored once, addressed by a hash of its
-- content, and referenced from the policy payload (productSnapshot.id).
-- Rows are immutable: a changed definition is a new row.
CREATE TABLE IF NOT EXISTS product_snapshots (
  snapshot_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  product_code text NOT NULL,
  content_hash text NOT NULL,
  -- Where the definition came from: release, carrier pack version, workbook.
  source jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- rates, product config, screen rules, rating adapter, published workbook.
  definition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, product_code, content_hash)
);

ALTER TABLE product_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON product_snapshots;
CREATE POLICY tenant_isolation ON product_snapshots
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

COMMIT;
