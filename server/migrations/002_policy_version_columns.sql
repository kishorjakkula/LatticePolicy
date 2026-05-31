BEGIN;

ALTER TABLE policy_versions
  ADD COLUMN IF NOT EXISTS premium_total numeric(14,2),
  ADD COLUMN IF NOT EXISTS premium_fees numeric(14,2),
  ADD COLUMN IF NOT EXISTS premium_taxes numeric(14,2);

ALTER TABLE policy_versions
  ADD COLUMN IF NOT EXISTS currency char(3);

UPDATE policy_versions
SET
  premium_total = COALESCE(
    premium_total,
    NULLIF(premium_summary -> 'total' ->> 'amount', '')::numeric
  ),
  premium_fees = COALESCE(
    premium_fees,
    NULLIF(premium_summary -> 'fees' ->> 'amount', '')::numeric
  ),
  premium_taxes = COALESCE(
    premium_taxes,
    NULLIF(premium_summary -> 'taxes' ->> 'amount', '')::numeric
  ),
  currency = COALESCE(
    currency,
    currency_code,
    premium_summary -> 'total' ->> 'currency',
    'USD'
  );

ALTER TABLE policy_versions DROP COLUMN IF EXISTS premium_summary;
ALTER TABLE policy_versions DROP COLUMN IF EXISTS currency_code;

COMMIT;
