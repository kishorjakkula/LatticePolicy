BEGIN;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS onboarding_config jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS onboarding_key_sequences (
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  entity_kind text NOT NULL CHECK (entity_kind IN ('AGENCY', 'PRODUCER')),
  sequence_year int NOT NULL,
  last_value bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, entity_kind, sequence_year)
);

CREATE TABLE IF NOT EXISTS agencies (
  agency_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  agency_key text NOT NULL,
  status text NOT NULL DEFAULT 'PROSPECT'
    CHECK (status IN ('PROSPECT', 'PENDING_COMPLIANCE', 'PENDING_CONTRACT', 'PENDING_APPOINTMENT', 'ACTIVE', 'SUSPENDED', 'TERMINATED')),
  legal_name text NOT NULL,
  dba_name text,
  fein_encrypted text,
  fein_last4 text,
  fein_hash text,
  agency_np_number text,
  agency_type text NOT NULL DEFAULT 'INDEPENDENT'
    CHECK (agency_type IN ('INDEPENDENT', 'CAPTIVE', 'MGA', 'WHOLESALER')),
  eo_carrier text,
  eo_policy_no text,
  eo_expiry_date date,
  ach_token_ref text,
  effective_from date,
  effective_to date,
  version int NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  UNIQUE (tenant_id, agency_id),
  UNIQUE (tenant_id, agency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_agencies_tenant_npn
  ON agencies(tenant_id, agency_np_number)
  WHERE agency_np_number IS NOT NULL AND agency_np_number <> '';
CREATE INDEX IF NOT EXISTS idx_agencies_tenant_status ON agencies(tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agencies_tenant_name ON agencies(tenant_id, lower(legal_name));

CREATE TABLE IF NOT EXISTS producers (
  producer_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  producer_key text NOT NULL,
  status text NOT NULL DEFAULT 'INVITED'
    CHECK (status IN ('INVITED', 'PENDING_LICENSE', 'PENDING_APPOINTMENT', 'ACTIVE', 'RESTRICTED', 'SUSPENDED')),
  first_name text NOT NULL,
  middle_name text,
  last_name text NOT NULL,
  dob_encrypted text,
  dob_hash text,
  npn text,
  version int NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  UNIQUE (tenant_id, producer_id),
  UNIQUE (tenant_id, producer_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_producers_tenant_npn
  ON producers(tenant_id, npn)
  WHERE npn IS NOT NULL AND npn <> '';
CREATE INDEX IF NOT EXISTS idx_producers_tenant_status ON producers(tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_producers_tenant_name ON producers(tenant_id, lower(last_name), lower(first_name));

CREATE TABLE IF NOT EXISTS agency_producer_affiliations (
  affiliation_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  agency_id uuid NOT NULL,
  producer_id uuid NOT NULL,
  affiliation_role text NOT NULL DEFAULT 'PRODUCER',
  effective_from date,
  effective_to date,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  CONSTRAINT fk_affiliation_agency
    FOREIGN KEY (tenant_id, agency_id)
    REFERENCES agencies(tenant_id, agency_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_affiliation_producer
    FOREIGN KEY (tenant_id, producer_id)
    REFERENCES producers(tenant_id, producer_id)
    ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_affiliations_active
  ON agency_producer_affiliations(tenant_id, agency_id, producer_id, affiliation_role)
  WHERE effective_to IS NULL;

CREATE TABLE IF NOT EXISTS onboarding_contact_points (
  contact_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('AGENCY', 'PRODUCER')),
  entity_id uuid NOT NULL,
  contact_type text NOT NULL CHECK (contact_type IN ('PHONE', 'EMAIL')),
  sub_type text,
  value text NOT NULL,
  normalized_value text,
  extension text,
  preferred_flag boolean NOT NULL DEFAULT false,
  verified_flag boolean NOT NULL DEFAULT false,
  bounce_flag boolean NOT NULL DEFAULT false,
  sms_consent boolean NOT NULL DEFAULT false,
  email_consent boolean NOT NULL DEFAULT false,
  contact_window text,
  language_preference text,
  effective_from date,
  effective_to date,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
CREATE INDEX IF NOT EXISTS idx_onboarding_contact_entity
  ON onboarding_contact_points(tenant_id, entity_type, entity_id, contact_type);
CREATE INDEX IF NOT EXISTS idx_onboarding_contact_lookup
  ON onboarding_contact_points(tenant_id, contact_type, normalized_value);
CREATE UNIQUE INDEX IF NOT EXISTS ux_onboarding_contact_preferred
  ON onboarding_contact_points(tenant_id, entity_type, entity_id, contact_type)
  WHERE preferred_flag = true AND effective_to IS NULL;

CREATE TABLE IF NOT EXISTS onboarding_addresses (
  address_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('AGENCY', 'PRODUCER')),
  entity_id uuid NOT NULL,
  address_type text NOT NULL,
  line1 text,
  line2 text,
  line3 text,
  city text,
  state text,
  postal_code text,
  country text,
  county text,
  primary_flag boolean NOT NULL DEFAULT false,
  validation_status text NOT NULL DEFAULT 'unvalidated',
  geocode_lat numeric(10, 7),
  geocode_lng numeric(10, 7),
  effective_from date,
  effective_to date,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
CREATE INDEX IF NOT EXISTS idx_onboarding_address_entity
  ON onboarding_addresses(tenant_id, entity_type, entity_id, address_type);
CREATE UNIQUE INDEX IF NOT EXISTS ux_onboarding_address_primary
  ON onboarding_addresses(tenant_id, entity_type, entity_id, address_type)
  WHERE primary_flag = true AND effective_to IS NULL;

CREATE TABLE IF NOT EXISTS onboarding_licenses (
  license_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('AGENCY', 'PRODUCER')),
  entity_id uuid NOT NULL,
  state text NOT NULL,
  line_of_authority text NOT NULL,
  license_no text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'EXPIRED', 'SUSPENDED', 'PENDING')),
  effective_from date,
  effective_to date,
  last_verified_at timestamptz,
  source_system text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
CREATE INDEX IF NOT EXISTS idx_onboarding_license_entity
  ON onboarding_licenses(tenant_id, entity_type, entity_id, state, line_of_authority);
CREATE UNIQUE INDEX IF NOT EXISTS ux_onboarding_license_unique
  ON onboarding_licenses(tenant_id, entity_type, entity_id, state, line_of_authority, license_no, coalesce(effective_from, '1900-01-01'::date));

CREATE TABLE IF NOT EXISTS onboarding_appointments (
  appointment_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('AGENCY', 'PRODUCER')),
  entity_id uuid NOT NULL,
  carrier_code text NOT NULL,
  state text NOT NULL,
  product_code text NOT NULL,
  appointment_status text NOT NULL CHECK (appointment_status IN ('REQUESTED', 'ACTIVE', 'TERMINATED', 'PENDING')),
  appointment_effective_date date,
  termination_date date,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
CREATE INDEX IF NOT EXISTS idx_onboarding_appointment_entity
  ON onboarding_appointments(tenant_id, entity_type, entity_id, state, product_code);
CREATE UNIQUE INDEX IF NOT EXISTS ux_onboarding_appointment_unique
  ON onboarding_appointments(tenant_id, entity_type, entity_id, carrier_code, state, product_code, coalesce(appointment_effective_date, '1900-01-01'::date));

CREATE TABLE IF NOT EXISTS onboarding_commission_plans (
  commission_plan_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  assigned_to text NOT NULL CHECK (assigned_to IN ('AGENCY', 'PRODUCER', 'MGA')),
  entity_id uuid NOT NULL,
  product_code text NOT NULL,
  state text NOT NULL,
  nb_rate numeric(7, 4) NOT NULL DEFAULT 0,
  rn_rate numeric(7, 4) NOT NULL DEFAULT 0,
  endorsements_rate numeric(7, 4) NOT NULL DEFAULT 0,
  overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  chargeback_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_from date,
  effective_to date,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
CREATE INDEX IF NOT EXISTS idx_onboarding_commission_entity
  ON onboarding_commission_plans(tenant_id, assigned_to, entity_id, product_code, state);
CREATE UNIQUE INDEX IF NOT EXISTS ux_onboarding_commission_unique
  ON onboarding_commission_plans(tenant_id, assigned_to, entity_id, product_code, state, coalesce(effective_from, '1900-01-01'::date));

CREATE TABLE IF NOT EXISTS onboarding_external_identifiers (
  external_identifier_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('AGENCY', 'PRODUCER')),
  entity_id uuid NOT NULL,
  source_system text NOT NULL,
  external_id text NOT NULL,
  id_type text,
  active_flag boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  UNIQUE (tenant_id, source_system, external_id)
);
CREATE INDEX IF NOT EXISTS idx_onboarding_external_entity
  ON onboarding_external_identifiers(tenant_id, entity_type, entity_id);

CREATE TABLE IF NOT EXISTS onboarding_audit_events (
  event_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid,
  event_type text NOT NULL,
  actor text,
  reason text,
  correlation_id text,
  before_json jsonb,
  after_json jsonb,
  field_diffs jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_onboarding_audit_entity
  ON onboarding_audit_events(tenant_id, entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS onboarding_jobs (
  job_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('UPLOAD', 'SERVICE_HIT', 'MANUAL')),
  source_type text,
  source_name text,
  source_system text,
  idempotency_strategy text NOT NULL DEFAULT 'EXTERNAL_ID_WINS'
    CHECK (idempotency_strategy IN ('EXTERNAL_ID_WINS', 'KEY_WINS', 'ALWAYS_CREATE')),
  conflict_behavior text NOT NULL DEFAULT 'SKIP'
    CHECK (conflict_behavior IN ('SKIP', 'OVERWRITE_ALLOWED', 'REQUIRE_APPROVAL')),
  status text NOT NULL DEFAULT 'RUNNING'
    CHECK (status IN ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')),
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_preview jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalized_output jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  log_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_received int NOT NULL DEFAULT 0,
  total_validated int NOT NULL DEFAULT 0,
  total_created int NOT NULL DEFAULT 0,
  total_updated int NOT NULL DEFAULT 0,
  total_skipped int NOT NULL DEFAULT 0,
  total_failed int NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
CREATE INDEX IF NOT EXISTS idx_onboarding_jobs_tenant_status
  ON onboarding_jobs(tenant_id, status, started_at DESC);

CREATE TABLE IF NOT EXISTS onboarding_job_rows (
  row_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES onboarding_jobs(job_id) ON DELETE CASCADE,
  row_no int NOT NULL,
  source_sheet text,
  entity_type text NOT NULL CHECK (entity_type IN ('AGENCY', 'PRODUCER', 'LICENSE', 'APPOINTMENT', 'COMMISSION')),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_type text NOT NULL DEFAULT 'CREATE' CHECK (action_type IN ('CREATE', 'UPDATE', 'SKIP')),
  row_status text NOT NULL DEFAULT 'STAGED'
    CHECK (row_status IN ('STAGED', 'VALIDATED', 'ERROR', 'COMMITTED', 'FAILED', 'SKIPPED', 'PENDING_APPROVAL')),
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  match_candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  commit_message text,
  linked_entity_type text,
  linked_entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, job_id, row_no, entity_type)
);
CREATE INDEX IF NOT EXISTS idx_onboarding_job_rows_job
  ON onboarding_job_rows(tenant_id, job_id, row_no);

CREATE TABLE IF NOT EXISTS onboarding_approval_tasks (
  task_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  job_id uuid REFERENCES onboarding_jobs(job_id) ON DELETE SET NULL,
  row_id uuid REFERENCES onboarding_job_rows(row_id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  action_type text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by text,
  reviewed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_onboarding_approval_tasks_tenant
  ON onboarding_approval_tasks(tenant_id, status, requested_at DESC);

ALTER TABLE agencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE producers ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_key_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_producer_affiliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_contact_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_commission_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_external_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_job_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_approval_tasks ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'agencies',
    'producers',
    'onboarding_key_sequences',
    'agency_producer_affiliations',
    'onboarding_contact_points',
    'onboarding_addresses',
    'onboarding_licenses',
    'onboarding_appointments',
    'onboarding_commission_plans',
    'onboarding_external_identifiers',
    'onboarding_audit_events',
    'onboarding_jobs',
    'onboarding_job_rows',
    'onboarding_approval_tasks'
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
