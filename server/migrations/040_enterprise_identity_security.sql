-- Enterprise identity and security controls: per-tenant SSO configuration and
-- local-auth kill switch, plus account lockout / password policy state and
-- SSO-linked account fields on users.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS local_auth_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sso_config jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS failed_login_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS password_updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS auth_provider text NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS external_subject text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_external_subject
  ON users(tenant_id, external_subject)
  WHERE external_subject IS NOT NULL;
