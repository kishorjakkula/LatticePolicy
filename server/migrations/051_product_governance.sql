BEGIN;

CREATE TABLE product_governance_releases (
  release_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  product_code text NOT NULL,
  jurisdiction_code text,
  version_label text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'REVIEW', 'APPROVED', 'SCHEDULED', 'ACTIVE', 'RETIRED')),
  effective_date date NOT NULL,
  expiration_date date,
  artifacts jsonb NOT NULL,
  content_sha256 text NOT NULL,
  created_by text NOT NULL,
  submitted_by text,
  submitted_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  activated_by text,
  activated_at timestamptz,
  retired_by text,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expiration_date IS NULL OR expiration_date >= effective_date)
);

CREATE TABLE product_governance_audit (
  audit_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  release_id uuid NOT NULL REFERENCES product_governance_releases(release_id) ON DELETE CASCADE,
  action text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  actor text NOT NULL,
  reason text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_product_governance_lookup
  ON product_governance_releases(tenant_id, product_code, COALESCE(jurisdiction_code, ''), status, effective_date);
CREATE INDEX idx_product_governance_audit
  ON product_governance_audit(tenant_id, release_id, occurred_at);
CREATE UNIQUE INDEX ux_product_governance_version
  ON product_governance_releases(tenant_id, product_code, COALESCE(jurisdiction_code, ''), version_label);

CREATE OR REPLACE FUNCTION protect_product_governance_artifact()
RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'DRAFT' AND (
    NEW.product_code IS DISTINCT FROM OLD.product_code OR
    NEW.jurisdiction_code IS DISTINCT FROM OLD.jurisdiction_code OR
    NEW.version_label IS DISTINCT FROM OLD.version_label OR
    NEW.effective_date IS DISTINCT FROM OLD.effective_date OR
    NEW.expiration_date IS DISTINCT FROM OLD.expiration_date OR
    NEW.artifacts IS DISTINCT FROM OLD.artifacts OR
    NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
  ) THEN
    RAISE EXCEPTION 'submitted product governance artifacts are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER product_governance_artifact_immutable
  BEFORE UPDATE ON product_governance_releases
  FOR EACH ROW EXECUTE FUNCTION protect_product_governance_artifact();

ALTER TABLE product_governance_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_governance_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON product_governance_releases
  USING (tenant_id = current_setting('app.tenant_id'));
CREATE POLICY tenant_isolation ON product_governance_audit
  USING (tenant_id = current_setting('app.tenant_id'));

COMMIT;
