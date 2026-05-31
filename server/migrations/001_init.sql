BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop legacy tables to allow clean bootstrap
DROP TABLE IF EXISTS policy_version_changes CASCADE;
DROP TABLE IF EXISTS coverage_selections CASCADE;
DROP TABLE IF EXISTS dwellings CASCADE;
DROP TABLE IF EXISTS auto_vehicles CASCADE;
DROP TABLE IF EXISTS policy_versions CASCADE;
DROP TABLE IF EXISTS ledger_events CASCADE;
DROP TABLE IF EXISTS field_meta CASCADE;
DROP TABLE IF EXISTS regulatory_rules CASCADE;
DROP TABLE IF EXISTS jurisdictions CASCADE;
DROP TABLE IF EXISTS ratings CASCADE;
DROP TABLE IF EXISTS notes CASCADE;
DROP TABLE IF EXISTS uw_decisions CASCADE;
DROP TABLE IF EXISTS documents CASCADE;
DROP TABLE IF EXISTS policy_forms CASCADE;
DROP TABLE IF EXISTS forms_catalog CASCADE;
DROP TABLE IF EXISTS coverage_definitions CASCADE;
DROP TABLE IF EXISTS coverages CASCADE;
DROP TABLE IF EXISTS risk_units CASCADE;
DROP TABLE IF EXISTS policy_transactions CASCADE;
DROP TABLE IF EXISTS policies CASCADE;
DROP TABLE IF EXISTS policy_role_assignments CASCADE;
DROP TABLE IF EXISTS policy_parties CASCADE;
DROP TABLE IF EXISTS party_roles CASCADE;
DROP TABLE IF EXISTS party_licenses CASCADE;
DROP TABLE IF EXISTS party_contacts CASCADE;
DROP TABLE IF EXISTS parties CASCADE;
DROP TABLE IF EXISTS user_roles CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS quotes CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;

DROP TYPE IF EXISTS policy_status_enum CASCADE;
DROP TYPE IF EXISTS txn_type_enum CASCADE;
DROP TYPE IF EXISTS txn_status_enum CASCADE;

CREATE TYPE policy_status_enum AS ENUM ('Quote','Draft','Bound','Issued','Cancelled','Expired');
CREATE TYPE txn_type_enum AS ENUM ('NB','ENDORSE','CANCEL','REINSTATE','REWRITE','RENEW');
CREATE TYPE txn_status_enum AS ENUM ('InProgress','Quoted','Approved','Declined','Bound','Issued','Voided');

-- Core tenant & user structures ------------------------------------------------
CREATE TABLE tenants (
  tenant_id text PRIMARY KEY,
  name text NOT NULL,
  default_locale text,
  default_currency char(3),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  user_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role_code text NOT NULL,
  PRIMARY KEY (user_id, role_code)
);

-- Party & role catalogue -------------------------------------------------------
CREATE TABLE parties (
  party_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  type text NOT NULL, -- Person | Org
  name jsonb,
  org jsonb,
  status text,
  ext jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_parties_tenant_type ON parties(tenant_id, type);

CREATE TABLE party_contacts (
  contact_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  party_id uuid NOT NULL REFERENCES parties(party_id) ON DELETE CASCADE,
  contact_type text NOT NULL,
  contact_value text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  metadata jsonb
);
CREATE INDEX idx_party_contacts_party ON party_contacts(party_id, contact_type);

CREATE TABLE party_licenses (
  license_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  party_id uuid NOT NULL REFERENCES parties(party_id) ON DELETE CASCADE,
  license_type text NOT NULL,
  license_number text NOT NULL,
  jurisdiction_code text,
  expires_on date,
  metadata jsonb
);
CREATE INDEX idx_party_licenses_party ON party_licenses(party_id);

CREATE TABLE party_roles (
  party_role_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  party_id uuid NOT NULL REFERENCES parties(party_id) ON DELETE CASCADE,
  role_code text NOT NULL,
  metadata jsonb
);
CREATE INDEX idx_party_roles_party ON party_roles(party_id, role_code);

-- Policies ---------------------------------------------------------------------
CREATE TABLE policies (
  policy_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  policy_number varchar(40),
  status policy_status_enum NOT NULL DEFAULT 'Quote',
  product_code text NOT NULL,
  product_version text,
  jurisdiction_code text,
  jurisdiction jsonb,
  term jsonb,
  term_effective_date date NOT NULL,
  term_expiration_date date NOT NULL,
  term_type text,
  currency_code char(3),
  currency jsonb,
  lifecycle jsonb,
  external_ids jsonb,
  insured_party_id uuid REFERENCES parties(party_id),
  premium_summary jsonb,
  risk_summary jsonb,
  forms_summary jsonb,
  documents_summary jsonb,
  audit_log jsonb,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_policies_tenant_number ON policies(tenant_id, policy_number) WHERE policy_number IS NOT NULL;
CREATE INDEX idx_policies_tenant_status ON policies(tenant_id, status);
CREATE INDEX idx_policies_tenant_product ON policies(tenant_id, product_code);
CREATE INDEX idx_policies_term_dates ON policies(term_effective_date, term_expiration_date);
CREATE INDEX idx_policies_insured ON policies(insured_party_id);

CREATE TABLE policy_parties (
  policy_party_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES policies(policy_id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES parties(party_id) ON DELETE CASCADE,
  role_code text NOT NULL,
  relationship text,
  is_primary boolean NOT NULL DEFAULT false,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_policy_parties_policy ON policy_parties(tenant_id, policy_id, role_code);

CREATE TABLE policy_role_assignments (
  assignment_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES policies(policy_id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES parties(party_id) ON DELETE CASCADE,
  role_code text NOT NULL,
  permissions text[] NOT NULL DEFAULT ARRAY[]::text[],
  scope jsonb,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid,
  metadata jsonb
);
CREATE UNIQUE INDEX ux_policy_role_assignments ON policy_role_assignments(tenant_id, policy_id, party_id, role_code);

-- Transactions & lifecycle -----------------------------------------------------
CREATE TABLE policy_transactions (
  transaction_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES policies(policy_id) ON DELETE CASCADE,
  type txn_type_enum NOT NULL,
  status txn_status_enum NOT NULL,
  jurisdiction jsonb,
  term jsonb,
  requested_changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  snapshot jsonb,
  rating_id uuid,
  uw jsonb,
  notes jsonb,
  forms jsonb,
  documents jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz,
  metadata jsonb
);
CREATE INDEX idx_policy_transactions_policy ON policy_transactions(tenant_id, policy_id, created_at DESC);
CREATE INDEX idx_policy_transactions_status ON policy_transactions(tenant_id, status);
CREATE INDEX idx_policy_transactions_type ON policy_transactions(tenant_id, type);

CREATE TABLE policy_versions (
  version_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES policies(policy_id) ON DELETE CASCADE,
  transaction_id uuid REFERENCES policy_transactions(transaction_id) ON DELETE SET NULL,
  effective_date date NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  transaction_type txn_type_enum NOT NULL,
  premium_summary jsonb,
  currency_code char(3),
  uw_decision text,
  uw_override boolean,
  override_reason text,
  calc_trace jsonb,
  payload jsonb
);
CREATE INDEX idx_policy_versions_policy ON policy_versions(tenant_id, policy_id, processed_at DESC);

CREATE TABLE policy_version_changes (
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES policies(policy_id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES policy_versions(version_id) ON DELETE CASCADE,
  path text NOT NULL,
  old jsonb,
  new jsonb,
  PRIMARY KEY (tenant_id, policy_id, version_id, path)
);

-- Rating -----------------------------------------------------------------------
CREATE TABLE ratings (
  rating_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES policies(policy_id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES policy_transactions(transaction_id) ON DELETE CASCADE,
  inputs jsonb,
  components jsonb,
  discounts jsonb,
  surcharges jsonb,
  taxes jsonb,
  total_premium numeric(14,2),
  currency_code char(3),
  calc_trace jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_ratings_policy_tx ON ratings(tenant_id, policy_id, transaction_id);

-- Risk units -------------------------------------------------------------------
CREATE TABLE risk_units (
  risk_unit_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES policies(policy_id) ON DELETE CASCADE,
  transaction_id uuid REFERENCES policy_transactions(transaction_id) ON DELETE SET NULL,
  kind text NOT NULL,
  attributes jsonb NOT NULL,
  effective_date date,
  expiration_date date,
  metadata jsonb,
  voided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_risk_units_policy_kind ON risk_units(tenant_id, policy_id, kind);
CREATE INDEX idx_risk_units_transaction ON risk_units(tenant_id, transaction_id);

CREATE TABLE risk_unit_vehicle (
  risk_unit_id uuid PRIMARY KEY REFERENCES risk_units(risk_unit_id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  vin text,
  year smallint,
  make text,
  model text,
  symbol text,
  usage text,
  annual_mileage int,
  garaging_postal text,
  ownership text,
  metadata jsonb
);

CREATE TABLE risk_unit_driver (
  risk_unit_id uuid PRIMARY KEY REFERENCES risk_units(risk_unit_id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  party_id uuid REFERENCES parties(party_id),
  license_number text,
  license_state text,
  date_of_birth date,
  points smallint,
  accidents_5y smallint,
  violations_5y smallint,
  training boolean,
  good_student boolean,
  metadata jsonb
);

CREATE TABLE risk_unit_dwelling (
  risk_unit_id uuid PRIMARY KEY REFERENCES risk_units(risk_unit_id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  address jsonb,
  construction text,
  roof text,
  roof_age_years int,
  sqft int,
  num_stories int,
  occupancy text,
  protection_class int,
  distance_to_hydrant numeric,
  heating text,
  alarms jsonb,
  metadata jsonb
);

CREATE TABLE risk_unit_other_structure (
  risk_unit_id uuid PRIMARY KEY REFERENCES risk_units(risk_unit_id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  description text,
  replacement_cost numeric(14,2),
  metadata jsonb
);

CREATE TABLE risk_unit_liability (
  risk_unit_id uuid PRIMARY KEY REFERENCES risk_units(risk_unit_id) ON DELETE CASCADE,
  tenant_id text NOT NULL,
  attributes jsonb
);

-- Coverages --------------------------------------------------------------------
CREATE TABLE coverage_definitions (
  definition_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL,
  code text NOT NULL,
  product text NOT NULL,
  version text NOT NULL DEFAULT '1.0.0',
  title text,
  applies_to text,
  limit_model jsonb,
  deductible_model jsonb,
  rating_hooks text[],
  form_hooks text[],
  ui jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_coverage_definitions ON coverage_definitions(tenant_id, code, version);

CREATE TABLE coverages (
  coverage_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES policies(policy_id) ON DELETE CASCADE,
  transaction_id uuid REFERENCES policy_transactions(transaction_id) ON DELETE SET NULL,
  risk_unit_id uuid REFERENCES risk_units(risk_unit_id),
  applies_to text,
  definition_code text NOT NULL,
  limits jsonb,
  deductibles jsonb,
  options jsonb,
  selected boolean NOT NULL DEFAULT true,
  effective_date date,
  expiration_date date,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_coverages_policy ON coverages(tenant_id, policy_id, definition_code);
CREATE INDEX idx_coverages_transaction ON coverages(tenant_id, transaction_id);

CREATE TABLE coverage_selections (
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES policies(policy_id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES policy_versions(version_id) ON DELETE CASCADE,
  coverage_code text NOT NULL,
  selected boolean NOT NULL DEFAULT true,
  limit_value jsonb,
  deductible jsonb,
  metadata jsonb,
  PRIMARY KEY (tenant_id, policy_id, version_id, coverage_code)
);

-- Forms & Documents ------------------------------------------------------------
CREATE TABLE forms_catalog (
  form_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL,
  code text NOT NULL,
  edition text,
  name text,
  jurisdiction jsonb,
  applicability jsonb,
  render jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_forms_catalog_code ON forms_catalog(tenant_id, code);

CREATE TABLE policy_forms (
  policy_form_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL,
  policy_id uuid NOT NULL REFERENCES policies(policy_id) ON DELETE CASCADE,
  transaction_id uuid REFERENCES policy_transactions(transaction_id) ON DELETE SET NULL,
  form_id uuid REFERENCES forms_catalog(form_id),
  code text,
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb
);
CREATE INDEX idx_policy_forms_policy ON policy_forms(tenant_id, policy_id);

CREATE TABLE documents (
  document_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL,
  policy_id uuid REFERENCES policies(policy_id) ON DELETE CASCADE,
  transaction_id uuid REFERENCES policy_transactions(transaction_id) ON DELETE SET NULL,
  type text NOT NULL,
  uri text NOT NULL,
  hash text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX idx_documents_policy ON documents(tenant_id, policy_id, created_at DESC);

-- Notes & UW decisions ---------------------------------------------------------
CREATE TABLE notes (
  note_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL,
  transaction_id uuid NOT NULL REFERENCES policy_transactions(transaction_id) ON DELETE CASCADE,
  note_type text NOT NULL,
  note_text text NOT NULL,
  visibility text[] NOT NULL DEFAULT ARRAY[]::text[],
  added_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb
);
CREATE INDEX idx_notes_transaction ON notes(tenant_id, transaction_id, created_at DESC);

CREATE TABLE uw_decisions (
  decision_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL,
  transaction_id uuid NOT NULL REFERENCES policy_transactions(transaction_id) ON DELETE CASCADE,
  rules_triggered text[],
  decision text NOT NULL,
  conditions text[],
  decided_by uuid,
  decided_at timestamptz,
  metadata jsonb
);
CREATE UNIQUE INDEX ux_uw_decisions_tx ON uw_decisions(tenant_id, transaction_id);

-- Jurisdictions & regulatory rules ---------------------------------------------
CREATE TABLE jurisdictions (
  jurisdiction_code text PRIMARY KEY,
  tenant_id text NOT NULL,
  country text,
  region text,
  currency char(3),
  tax jsonb,
  compliance jsonb,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE regulatory_rules (
  rule_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL,
  jurisdiction_code text NOT NULL REFERENCES jurisdictions(jurisdiction_code) ON DELETE CASCADE,
  rule_type text,
  payload jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_regulatory_rules_jurisdiction ON regulatory_rules(tenant_id, jurisdiction_code);

-- Field metadata & ledger ------------------------------------------------------
CREATE TABLE field_meta (
  meta_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL,
  path text NOT NULL,
  type text,
  enum_values text[],
  required boolean,
  visible_to text[],
  editable_by text[],
  validation jsonb,
  i18n jsonb,
  ui jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_field_meta_path ON field_meta(tenant_id, path) WHERE active;

CREATE TABLE ledger_events (
  event_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  event text NOT NULL,
  from_state text,
  to_state text,
  payload jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor uuid
);
CREATE INDEX idx_ledger_events_entity ON ledger_events(tenant_id, entity_type, entity_id, occurred_at DESC);

-- Quotes table for submissions -------------------------------------------------
CREATE TABLE quotes (
  quote_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL,
  product_code text NOT NULL,
  effective_date date NOT NULL,
  term_months int NOT NULL,
  jurisdiction_code text,
  payload jsonb NOT NULL,
  underwriting jsonb,
  premium jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_quotes_tenant ON quotes(tenant_id, product_code);

-- Row level security -----------------------------------------------------------
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_version_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_unit_vehicle ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_unit_driver ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_unit_dwelling ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_unit_other_structure ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_unit_liability ENABLE ROW LEVEL SECURITY;
ALTER TABLE coverage_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE coverages ENABLE ROW LEVEL SECURITY;
ALTER TABLE coverage_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE forms_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE uw_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE jurisdictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE regulatory_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;

-- Tenant isolation policies
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = current_schema() AND tablename='tenants' AND policyname='tenant_isolation') THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON tenants USING (tenant_id = current_setting(''app.tenant_id''))';
  END IF;
END $$;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'users','user_roles','parties','party_contacts','party_licenses','party_roles',
    'policies','policy_parties','policy_role_assignments','policy_transactions','policy_versions',
    'policy_version_changes','ratings','risk_units','risk_unit_vehicle','risk_unit_driver',
    'risk_unit_dwelling','risk_unit_other_structure','risk_unit_liability','coverage_definitions',
    'coverages','coverage_selections','forms_catalog','policy_forms','documents','notes',
    'uw_decisions','jurisdictions','regulatory_rules','field_meta','ledger_events','quotes'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = tbl
        AND column_name = 'tenant_id'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_policies
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

-- Allow global overrides for shared catalogs
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['coverage_definitions','forms_catalog','field_meta','jurisdictions','regulatory_rules'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = tbl
        AND column_name = 'tenant_id'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = current_schema()
        AND tablename = tbl
        AND policyname = 'tenant_or_global'
    ) THEN
      EXECUTE format(
        'CREATE POLICY tenant_or_global ON %I USING (tenant_id = current_setting(''app.tenant_id'') OR tenant_id = ''global'')',
        tbl
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
