BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS customer_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_users_customer'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT fk_users_customer
      FOREIGN KEY (tenant_id, customer_id)
      REFERENCES customers(tenant_id, customer_id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_tenant_customer
  ON users(tenant_id, customer_id)
  WHERE customer_id IS NOT NULL;

COMMIT;
