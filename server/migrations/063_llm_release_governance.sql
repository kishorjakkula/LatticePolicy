BEGIN;

CREATE TABLE llm_release_contacts (
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  email text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE TABLE llm_releases (
  release_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  version_label text NOT NULL,
  status text NOT NULL CHECK (status IN ('READY_FOR_VALIDATION','IN_VALIDATION','VALIDATED','REJECTED','PRODUCTION_AUTHORIZED')),
  artifacts jsonb NOT NULL,
  artifact_digest text NOT NULL,
  evaluation jsonb NOT NULL,
  validation jsonb,
  validation_authorization jsonb,
  production_authorization jsonb,
  created_by uuid NOT NULL REFERENCES users(user_id),
  validated_by uuid REFERENCES users(user_id),
  approved_by uuid REFERENCES users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, version_label)
);
CREATE TABLE llm_release_audit (
  event_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  release_id uuid NOT NULL REFERENCES llm_releases(release_id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(user_id),
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX llm_release_inbox ON llm_releases(tenant_id, status, created_at DESC);
CREATE INDEX llm_release_history ON llm_release_audit(tenant_id, release_id, created_at);
CREATE UNIQUE INDEX llm_release_email_once ON notification_intents(tenant_id, correlation_id, event_type)
  WHERE event_type='LLM_CANDIDATE_READY';

DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['llm_release_contacts','llm_releases','llm_release_audit'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))', tbl);
  END LOOP;
END $$;

INSERT INTO rbac_permissions(permission_code,scope,resource_key,action_key,label,description,sort_order) VALUES
 ('menu.admin.llm.view','menu','admin.llm','view','Admin Menu: LLM Releases','View private model release governance',800),
 ('page.admin.llm.view','page','admin.llm','view','Page: LLM Releases','Review private model candidates',801),
 ('llm.releases.read','api','llm.releases','read','LLM Releases: Read','Read tenant model releases',802),
 ('llm.releases.register','api','llm.releases','manage','LLM Releases: Register','Register evaluated candidates; no approval rights',803),
 ('llm.releases.review','api','llm.releases','approve','LLM Releases: Review','Test candidates and authorize production',804)
ON CONFLICT DO NOTHING;
INSERT INTO rbac_roles(tenant_id,role_code,role_name,description,is_system,active)
 SELECT t.tenant_id, r.code, r.name, r.description, true, true FROM tenants t CROSS JOIN (VALUES
  ('carrier_technical_admin','Carrier Technical Administrator','Validates private LLM releases and authorizes production'),
  ('llm_release_automation','LLM Release Automation','Registers evaluated candidates; cannot approve')) AS r(code,name,description)
ON CONFLICT DO NOTHING;
INSERT INTO rbac_role_permissions(tenant_id,role_code,permission_code,created_by)
 SELECT r.tenant_id,r.role_code,p.code,'migration:063' FROM rbac_roles r CROSS JOIN (VALUES
  ('menu.admin.view'),('menu.admin.llm.view'),('page.admin.llm.view'),('llm.releases.read'),('llm.releases.review')) p(code)
 WHERE r.role_code='carrier_technical_admin'
ON CONFLICT DO NOTHING;
INSERT INTO rbac_role_permissions(tenant_id,role_code,permission_code,created_by)
 SELECT r.tenant_id,r.role_code,p.code,'migration:063' FROM rbac_roles r CROSS JOIN (VALUES
  ('llm.releases.read'),('llm.releases.register')) p(code)
 WHERE r.role_code='llm_release_automation'
ON CONFLICT DO NOTHING;
COMMIT;
