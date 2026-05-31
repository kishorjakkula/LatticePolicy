BEGIN;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS default_country_code text NOT NULL DEFAULT 'US';

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS date_formats_by_country jsonb NOT NULL DEFAULT '{"US":"MM-DD-YYYY","CA":"MM-DD-YYYY"}'::jsonb;

UPDATE tenants
SET default_country_code = 'US'
WHERE COALESCE(NULLIF(trim(default_country_code), ''), '') = '';

UPDATE tenants
SET date_formats_by_country = '{"US":"MM-DD-YYYY","CA":"MM-DD-YYYY"}'::jsonb
WHERE date_formats_by_country IS NULL OR jsonb_typeof(date_formats_by_country) <> 'object';

COMMIT;
