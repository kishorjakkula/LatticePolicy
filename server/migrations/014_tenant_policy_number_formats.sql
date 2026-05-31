BEGIN;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS policy_number_formats_by_product jsonb NOT NULL DEFAULT '{"personal-auto":"PC-{ID8}","homeowners":"HO-{ID8}"}'::jsonb;

UPDATE tenants
SET policy_number_formats_by_product = '{"personal-auto":"PC-{ID8}","homeowners":"HO-{ID8}"}'::jsonb
WHERE policy_number_formats_by_product IS NULL OR jsonb_typeof(policy_number_formats_by_product) <> 'object';

COMMIT;
