BEGIN;

CREATE TABLE IF NOT EXISTS forms_admin_forms (
  form_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  carrier_code text NOT NULL,
  authority text NOT NULL,
  form_number text NOT NULL,
  form_title text NOT NULL,
  edition_date date NOT NULL,
  form_type text NOT NULL,
  line_of_business text NOT NULL,
  workflow_status text NOT NULL DEFAULT 'Draft',
  active boolean NOT NULL DEFAULT false,
  change_reason text,
  previous_form_id uuid REFERENCES forms_admin_forms(form_id) ON DELETE SET NULL,
  edit_lock boolean NOT NULL DEFAULT true,
  require_approved_jurisdiction boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_forms_admin_forms_identity
  ON forms_admin_forms(tenant_id, carrier_code, authority, form_number, edition_date);

CREATE INDEX IF NOT EXISTS idx_forms_admin_forms_status
  ON forms_admin_forms(tenant_id, workflow_status, active, line_of_business);

CREATE TABLE IF NOT EXISTS forms_admin_versions (
  version_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES forms_admin_forms(form_id) ON DELETE CASCADE,
  version_no integer NOT NULL,
  workflow_status text NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  change_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  correlation_id text
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_forms_admin_versions_form_version
  ON forms_admin_versions(tenant_id, form_id, version_no);

CREATE TABLE IF NOT EXISTS forms_admin_jurisdictions (
  jurisdiction_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES forms_admin_forms(form_id) ON DELETE CASCADE,
  state_code text NOT NULL,
  regulatory_status text NOT NULL DEFAULT 'Pending',
  approval_tracking_id text,
  effective_date date NOT NULL,
  sunset_date date,
  has_state_exceptions boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

CREATE INDEX IF NOT EXISTS idx_forms_admin_jurisdictions_form
  ON forms_admin_jurisdictions(tenant_id, form_id, state_code, effective_date);

CREATE TABLE IF NOT EXISTS forms_admin_applicability (
  applicability_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES forms_admin_forms(form_id) ON DELETE CASCADE,
  line_of_business text NOT NULL,
  product_code text NOT NULL,
  risk_unit_association text NOT NULL DEFAULT 'Policy',
  transaction_types text[] NOT NULL DEFAULT ARRAY[]::text[],
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

CREATE INDEX IF NOT EXISTS idx_forms_admin_applicability_form
  ON forms_admin_applicability(tenant_id, form_id, line_of_business, product_code);

CREATE TABLE IF NOT EXISTS forms_admin_triggers (
  trigger_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES forms_admin_forms(form_id) ON DELETE CASCADE,
  trigger_type text NOT NULL,
  condition_expression text,
  suppress_expression text,
  priority integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

CREATE INDEX IF NOT EXISTS idx_forms_admin_triggers_form
  ON forms_admin_triggers(tenant_id, form_id, active, priority);

CREATE TABLE IF NOT EXISTS forms_admin_output (
  output_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES forms_admin_forms(form_id) ON DELETE CASCADE,
  template_source text NOT NULL DEFAULT 'Static PDF',
  template_uri text,
  output_format text NOT NULL DEFAULT 'PDF',
  merge_scope text NOT NULL DEFAULT 'policy',
  packet_placement text NOT NULL DEFAULT 'End',
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_forms_admin_output_form
  ON forms_admin_output(tenant_id, form_id);

CREATE TABLE IF NOT EXISTS forms_admin_delivery (
  delivery_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES forms_admin_forms(form_id) ON DELETE CASCADE,
  delivery_methods text[] NOT NULL DEFAULT ARRAY[]::text[],
  visibility text[] NOT NULL DEFAULT ARRAY[]::text[],
  acknowledgement_required boolean NOT NULL DEFAULT false,
  esign_required boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_forms_admin_delivery_form
  ON forms_admin_delivery(tenant_id, form_id);

CREATE TABLE IF NOT EXISTS forms_admin_security (
  security_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES forms_admin_forms(form_id) ON DELETE CASCADE,
  allowed_roles text[] NOT NULL DEFAULT ARRAY['forms_admin','compliance_admin','read_only']::text[],
  edit_roles text[] NOT NULL DEFAULT ARRAY['forms_admin','compliance_admin']::text[],
  view_roles text[] NOT NULL DEFAULT ARRAY['forms_admin','compliance_admin','read_only','admin']::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_forms_admin_security_form
  ON forms_admin_security(tenant_id, form_id);

CREATE TABLE IF NOT EXISTS forms_admin_audit_events (
  audit_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  form_id uuid REFERENCES forms_admin_forms(form_id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  event_type text NOT NULL,
  correlation_id text NOT NULL,
  before_snapshot jsonb,
  after_snapshot jsonb,
  reason text,
  changed_by text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forms_admin_audit_form
  ON forms_admin_audit_events(tenant_id, form_id, changed_at DESC);

ALTER TABLE forms_admin_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms_admin_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms_admin_jurisdictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms_admin_applicability ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms_admin_triggers ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms_admin_output ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms_admin_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms_admin_security ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms_admin_audit_events ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'forms_admin_forms',
    'forms_admin_versions',
    'forms_admin_jurisdictions',
    'forms_admin_applicability',
    'forms_admin_triggers',
    'forms_admin_output',
    'forms_admin_delivery',
    'forms_admin_security',
    'forms_admin_audit_events'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = current_schema()
        AND tablename = tbl
        AND policyname = 'tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id''))',
        tbl
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
