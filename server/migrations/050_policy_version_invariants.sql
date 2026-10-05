BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS ux_policy_transactions_sequence
  ON policy_transactions(tenant_id, policy_id, sequence_no)
  WHERE sequence_no IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_policy_transactions_timeline_version
  ON policy_transactions(tenant_id, policy_id, timeline_version)
  WHERE timeline_version IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_policy_versions_timeline_version
  ON policy_versions(tenant_id, policy_id, timeline_version)
  WHERE timeline_version IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_policy_version_update()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'policy_versions rows are immutable; append a new version instead'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS policy_versions_immutable_update ON policy_versions;
CREATE TRIGGER policy_versions_immutable_update
  BEFORE UPDATE ON policy_versions
  FOR EACH ROW EXECUTE FUNCTION prevent_policy_version_update();

COMMIT;
