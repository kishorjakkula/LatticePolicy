BEGIN;

CREATE TABLE IF NOT EXISTS rbac_permissions (
  permission_code text PRIMARY KEY,
  scope text NOT NULL,
  resource_key text NOT NULL,
  action_key text NOT NULL,
  label text NOT NULL,
  description text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rbac_roles (
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  role_code text NOT NULL,
  role_name text NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, role_code)
);

CREATE TABLE IF NOT EXISTS rbac_role_permissions (
  tenant_id text NOT NULL,
  role_code text NOT NULL,
  permission_code text NOT NULL REFERENCES rbac_permissions(permission_code) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  PRIMARY KEY (tenant_id, role_code, permission_code),
  CONSTRAINT fk_rbac_role_permissions_role
    FOREIGN KEY (tenant_id, role_code)
    REFERENCES rbac_roles(tenant_id, role_code)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rbac_roles_tenant_active
  ON rbac_roles(tenant_id, active, role_code);
CREATE INDEX IF NOT EXISTS idx_rbac_role_permissions_tenant_role
  ON rbac_role_permissions(tenant_id, role_code);
CREATE INDEX IF NOT EXISTS idx_rbac_role_permissions_permission
  ON rbac_role_permissions(permission_code);

ALTER TABLE rbac_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE rbac_role_permissions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = current_schema()
      AND tablename = 'rbac_roles'
      AND policyname = 'tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON rbac_roles USING (tenant_id = current_setting(''app.tenant_id''))';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = current_schema()
      AND tablename = 'rbac_role_permissions'
      AND policyname = 'tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON rbac_role_permissions USING (tenant_id = current_setting(''app.tenant_id''))';
  END IF;
END $$;

COMMIT;
