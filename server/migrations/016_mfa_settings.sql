BEGIN;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS mfa_required boolean NOT NULL DEFAULT false;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_secret text;

UPDATE tenants
SET mfa_required = false
WHERE mfa_required IS NULL;

UPDATE users
SET mfa_enabled = false
WHERE mfa_enabled IS NULL;

COMMIT;
