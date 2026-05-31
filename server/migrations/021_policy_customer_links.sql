BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS ux_policies_tenant_policy_id
  ON policies(tenant_id, policy_id);

CREATE TABLE IF NOT EXISTS policy_customer_links (
  policy_customer_link_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  policy_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  role_code text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'quote',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, policy_id, customer_id, role_code),
  CONSTRAINT fk_policy_customer_links_policy
    FOREIGN KEY (tenant_id, policy_id)
    REFERENCES policies(tenant_id, policy_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_policy_customer_links_customer
    FOREIGN KEY (tenant_id, customer_id)
    REFERENCES customers(tenant_id, customer_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_policy_customer_links_customer
  ON policy_customer_links(tenant_id, customer_id, role_code);

CREATE INDEX IF NOT EXISTS idx_policy_customer_links_policy
  ON policy_customer_links(tenant_id, policy_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_policy_customer_links_primary_role
  ON policy_customer_links(tenant_id, policy_id, role_code)
  WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS idx_policies_metadata_customer_id
  ON policies(tenant_id, ((metadata->>'customerId')));

ALTER TABLE policy_customer_links ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = current_schema() AND tablename = 'policy_customer_links') THEN
    DROP POLICY IF EXISTS tenant_isolation_policy_customer_links ON policy_customer_links;
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

CREATE POLICY tenant_isolation_policy_customer_links ON policy_customer_links
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

COMMIT;
