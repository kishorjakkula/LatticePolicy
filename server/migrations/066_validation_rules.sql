BEGIN;

-- Carrier-configured validation rules for every level (screen, rate, bind,
-- issue) of every transaction (new business, endorsement, cancellation,
-- reinstatement, renewal, rewrite, non-renewal, or 'common' for all).
-- Evaluated by @lattice-policy/rules validation-rules.ts in the browser and
-- enforced by the API. Starts empty: no behavior changes until a carrier
-- adds rules.
CREATE TABLE validation_rules (
  rule_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  rule_code text NOT NULL CHECK (rule_code ~ '^[A-Z0-9][A-Z0-9_-]{1,59}$'),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('required', 'condition')),
  field_path text,
  condition text,
  applies_when text,
  levels text[] NOT NULL CHECK (cardinality(levels) > 0 AND levels <@ ARRAY['screen','rate','bind','issue']),
  transaction_types text[] NOT NULL CHECK (
    (transaction_types = ARRAY['common'])
    OR (cardinality(transaction_types) > 0 AND transaction_types <@ ARRAY['new_business','endorsement','cancellation','reinstatement','renewal','rewrite','non_renewal'])
  ),
  -- NULL: every product / every state.
  product_code text,
  state_code char(2),
  screen text CHECK (screen IN ('product','qualification','insureds','risk','coverages','rating','premium','forms')),
  severity text NOT NULL CHECK (severity IN ('error', 'warning')),
  message text NOT NULL,
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  expiration_date date,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, rule_code),
  CHECK (kind <> 'required' OR field_path IS NOT NULL),
  CHECK (kind <> 'condition' OR condition IS NOT NULL),
  CHECK (NOT ('screen' = ANY(levels)) OR screen IS NOT NULL),
  CHECK (expiration_date IS NULL OR expiration_date >= effective_date)
);
CREATE INDEX validation_rules_lookup ON validation_rules (tenant_id, active, product_code, state_code);

-- Every create, change and delete of a rule, with the full before/after.
CREATE TABLE validation_rule_audit (
  event_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  rule_id uuid NOT NULL,
  rule_code text NOT NULL,
  action text NOT NULL CHECK (action IN ('CREATED', 'UPDATED', 'DELETED')),
  actor text NOT NULL,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX validation_rule_audit_rule ON validation_rule_audit (tenant_id, rule_id, created_at);

-- A person continuing past a warning at bind or issue.
CREATE TABLE validation_acknowledgements (
  ack_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  level text NOT NULL CHECK (level IN ('bind', 'issue')),
  transaction_type text NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('quote', 'policy')),
  entity_id uuid NOT NULL,
  rule_code text NOT NULL,
  rule_version integer,
  message text NOT NULL,
  field_path text,
  acknowledged_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX validation_acknowledgements_entity ON validation_acknowledgements (tenant_id, entity_type, entity_id, created_at);

-- History tables are append-only (audit_append_only from migration 064).
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON validation_rule_audit
  FOR EACH ROW EXECUTE FUNCTION audit_append_only();
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON validation_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION audit_append_only();

DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['validation_rules','validation_rule_audit','validation_acknowledgements'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))', tbl);
  END LOOP;
END $$;

INSERT INTO rbac_permissions(permission_code,scope,resource_key,action_key,label,description,sort_order) VALUES
 ('menu.admin.validation_rules.view','menu','admin.validation_rules','view','Admin Menu: Validation Rules','View screen, rating, bind and issue validation rules',810),
 ('page.admin.validation_rules.view','page','admin.validation_rules','view','Page: Validation Rules','Configure validation rules for every transaction',811),
 ('admin.validation_rules.read','api','admin.validation_rules','read','Admin API: Validation Rules Read','Read validation rules and their history',812),
 ('admin.validation_rules.manage','api','admin.validation_rules','manage','Admin API: Validation Rules Manage','Create, change and delete validation rules',813)
ON CONFLICT DO NOTHING;
-- Existing tenants' admin role (new tenants get the full catalog).
INSERT INTO rbac_role_permissions(tenant_id,role_code,permission_code,created_by)
 SELECT r.tenant_id,r.role_code,p.code,'migration:066' FROM rbac_roles r CROSS JOIN (VALUES
  ('menu.admin.validation_rules.view'),('page.admin.validation_rules.view'),('admin.validation_rules.read'),('admin.validation_rules.manage')) p(code)
 WHERE r.role_code = 'admin'
   AND EXISTS (SELECT 1 FROM rbac_role_permissions g WHERE g.tenant_id = r.tenant_id AND g.role_code = r.role_code)
ON CONFLICT DO NOTHING;

COMMIT;
