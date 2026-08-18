-- Compliance admin support: OFAC screen disposition audit fields and
-- normalized-name lookup used to carry forward prior review decisions.

ALTER TABLE ofac_screens
  ADD COLUMN IF NOT EXISTS normalized_party_name TEXT,
  ADD COLUMN IF NOT EXISTS disposition_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_ofac_screens_normalized
  ON ofac_screens(tenant_id, normalized_party_name);
