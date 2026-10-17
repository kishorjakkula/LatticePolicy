-- Public carrier identity; tenant settings and issued document snapshots remain scoped.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS branding jsonb NOT NULL DEFAULT '{}'::jsonb;
