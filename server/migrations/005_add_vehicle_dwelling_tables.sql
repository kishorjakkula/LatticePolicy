BEGIN;

CREATE TABLE IF NOT EXISTS auto_vehicles (
  vehicle_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL,
  policy_id uuid NOT NULL REFERENCES policies(policy_id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES policy_versions(version_id) ON DELETE CASCADE,
  year smallint,
  make text,
  model text,
  vin text,
  symbol text,
  garaging_zip text,
  usage text,
  annual_miles int,
  driver_age int,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auto_vehicles_policy ON auto_vehicles(tenant_id, policy_id, version_id);

CREATE TABLE IF NOT EXISTS dwellings (
  dwelling_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL,
  policy_id uuid NOT NULL REFERENCES policies(policy_id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES policy_versions(version_id) ON DELETE CASCADE,
  address jsonb,
  construction text,
  protection_class int,
  year_built int,
  roof_age_years int,
  square_feet int,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dwellings_policy ON dwellings(tenant_id, policy_id, version_id);

COMMIT;
