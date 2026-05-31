BEGIN;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS customer_key_pattern text NOT NULL DEFAULT 'CUST-{YYYY}-{SEQ6}';

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS customer_validation_config jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS customer_workflow_config jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS customer_key_sequences (
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  sequence_year int NOT NULL,
  last_value bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, sequence_year)
);

CREATE TABLE IF NOT EXISTS customers (
  customer_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  customer_key text NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('INDIVIDUAL', 'COMPANY', 'BOTH')),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE', 'MERGED', 'PENDING_APPROVAL', 'ARCHIVED')),
  version int NOT NULL DEFAULT 1,
  survivor_customer_id uuid,
  display_name text,
  pending_approval boolean NOT NULL DEFAULT false,
  deactivation_reason text,
  deactivation_effective_date date,
  deactivated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, customer_key),
  UNIQUE (tenant_id, customer_id)
);

ALTER TABLE customers
  DROP CONSTRAINT IF EXISTS fk_customers_survivor;
ALTER TABLE customers
  ADD CONSTRAINT fk_customers_survivor
  FOREIGN KEY (tenant_id, survivor_customer_id)
  REFERENCES customers(tenant_id, customer_id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customers_tenant_status ON customers(tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_display_name ON customers(tenant_id, lower(coalesce(display_name, customer_key)));

CREATE TABLE IF NOT EXISTS customer_person_details (
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  first_name text,
  middle_name text,
  last_name text,
  suffix text,
  preferred_name text,
  dob_encrypted text,
  dob_hash text,
  gender text,
  marital_status text,
  ssn_encrypted text,
  ssn_last4 text,
  ssn_hash text,
  driver_license_no text,
  driver_license_state text,
  driver_license_expiry date,
  nationality text,
  residency text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, customer_id),
  CONSTRAINT fk_customer_person_customer
    FOREIGN KEY (tenant_id, customer_id)
    REFERENCES customers(tenant_id, customer_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customer_person_name
  ON customer_person_details(tenant_id, lower(coalesce(last_name, '')), lower(coalesce(first_name, '')));
CREATE INDEX IF NOT EXISTS idx_customer_person_dob_hash
  ON customer_person_details(tenant_id, dob_hash);
CREATE INDEX IF NOT EXISTS idx_customer_person_ssn_last4
  ON customer_person_details(tenant_id, ssn_last4);

CREATE TABLE IF NOT EXISTS customer_company_details (
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  legal_name text,
  dba_name text,
  fein_encrypted text,
  fein_last4 text,
  fein_hash text,
  entity_legal_type text,
  incorporation_state text,
  incorporation_country text,
  incorporation_date date,
  naics text,
  sic text,
  website text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, customer_id),
  CONSTRAINT fk_customer_company_customer
    FOREIGN KEY (tenant_id, customer_id)
    REFERENCES customers(tenant_id, customer_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customer_company_name
  ON customer_company_details(tenant_id, lower(coalesce(legal_name, '')));
CREATE INDEX IF NOT EXISTS idx_customer_company_fein_last4
  ON customer_company_details(tenant_id, fein_last4);

CREATE TABLE IF NOT EXISTS customer_contact_points (
  contact_point_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  contact_type text NOT NULL CHECK (contact_type IN ('PHONE', 'EMAIL')),
  sub_type text,
  value text NOT NULL,
  normalized_value text,
  preferred_flag boolean NOT NULL DEFAULT false,
  verified_flag boolean NOT NULL DEFAULT false,
  bounce_flag boolean NOT NULL DEFAULT false,
  sms_consent boolean NOT NULL DEFAULT false,
  email_consent boolean NOT NULL DEFAULT false,
  call_consent boolean NOT NULL DEFAULT false,
  contact_window text,
  language_preference text,
  effective_from date,
  effective_to date,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_customer_contact_customer
    FOREIGN KEY (tenant_id, customer_id)
    REFERENCES customers(tenant_id, customer_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customer_contact_norm
  ON customer_contact_points(tenant_id, contact_type, normalized_value);
CREATE INDEX IF NOT EXISTS idx_customer_contact_customer
  ON customer_contact_points(tenant_id, customer_id, contact_type);
CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_contact_preferred
  ON customer_contact_points(tenant_id, customer_id, contact_type)
  WHERE preferred_flag = true AND effective_to IS NULL;

CREATE TABLE IF NOT EXISTS customer_addresses (
  address_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
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
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_customer_address_customer
    FOREIGN KEY (tenant_id, customer_id)
    REFERENCES customers(tenant_id, customer_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customer_address_customer
  ON customer_addresses(tenant_id, customer_id, address_type);
CREATE INDEX IF NOT EXISTS idx_customer_address_search
  ON customer_addresses(tenant_id, lower(coalesce(city, '')), lower(coalesce(state, '')), lower(coalesce(postal_code, '')));
CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_address_primary
  ON customer_addresses(tenant_id, customer_id, address_type)
  WHERE primary_flag = true AND effective_to IS NULL;

CREATE TABLE IF NOT EXISTS customer_external_identifiers (
  external_identifier_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  source_system text NOT NULL,
  external_id text NOT NULL,
  id_type text,
  active_flag boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_customer_external_customer
    FOREIGN KEY (tenant_id, customer_id)
    REFERENCES customers(tenant_id, customer_id)
    ON DELETE CASCADE,
  UNIQUE (tenant_id, source_system, external_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_external_customer
  ON customer_external_identifiers(tenant_id, customer_id);

CREATE TABLE IF NOT EXISTS customer_relationships (
  relationship_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  related_customer_id uuid NOT NULL,
  relationship_type text NOT NULL,
  start_date date,
  end_date date,
  percent_ownership numeric(7, 4),
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  CONSTRAINT ck_customer_relationship_not_self CHECK (customer_id <> related_customer_id),
  CONSTRAINT fk_customer_relationship_customer
    FOREIGN KEY (tenant_id, customer_id)
    REFERENCES customers(tenant_id, customer_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_customer_relationship_related_customer
    FOREIGN KEY (tenant_id, related_customer_id)
    REFERENCES customers(tenant_id, customer_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customer_relationship_customer
  ON customer_relationships(tenant_id, customer_id, relationship_type);
CREATE INDEX IF NOT EXISTS idx_customer_relationship_related
  ON customer_relationships(tenant_id, related_customer_id, relationship_type);

CREATE TABLE IF NOT EXISTS customer_compliance (
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  kyc_status text,
  kyc_verification_date date,
  kyc_method text,
  sanctions_status text,
  sanctions_last_checked_at timestamptz,
  do_not_contact boolean NOT NULL DEFAULT false,
  data_retention_hold boolean NOT NULL DEFAULT false,
  right_to_be_forgotten_requested boolean NOT NULL DEFAULT false,
  privacy_region text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, customer_id),
  CONSTRAINT fk_customer_compliance_customer
    FOREIGN KEY (tenant_id, customer_id)
    REFERENCES customers(tenant_id, customer_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_notes (
  note_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  category text NOT NULL,
  note_text text NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT fk_customer_note_customer
    FOREIGN KEY (tenant_id, customer_id)
    REFERENCES customers(tenant_id, customer_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_attachments (
  attachment_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  document_id text NOT NULL,
  file_name text,
  file_type text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT fk_customer_attachment_customer
    FOREIGN KEY (tenant_id, customer_id)
    REFERENCES customers(tenant_id, customer_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_approvals (
  approval_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  action_type text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  requested_by text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by text,
  reviewed_at timestamptz,
  reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT fk_customer_approval_customer
    FOREIGN KEY (tenant_id, customer_id)
    REFERENCES customers(tenant_id, customer_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customer_approvals_customer
  ON customer_approvals(tenant_id, customer_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS customer_audit_events (
  event_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  event_type text NOT NULL,
  actor text,
  reason text,
  correlation_id text,
  before_json jsonb,
  after_json jsonb,
  field_diffs jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_customer_audit_customer
    FOREIGN KEY (tenant_id, customer_id)
    REFERENCES customers(tenant_id, customer_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customer_audit_customer
  ON customer_audit_events(tenant_id, customer_id, created_at DESC);

ALTER TABLE customer_key_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_person_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_company_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_contact_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_external_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_compliance ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_audit_events ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'customer_key_sequences',
    'customers',
    'customer_person_details',
    'customer_company_details',
    'customer_contact_points',
    'customer_addresses',
    'customer_external_identifiers',
    'customer_relationships',
    'customer_compliance',
    'customer_notes',
    'customer_attachments',
    'customer_approvals',
    'customer_audit_events'
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
