-- ============================================================
-- Migration 031: P0 Policy Features
-- Quote expiry, state eligibility, OFAC screening,
-- policy additional interests, cancellation reason codes,
-- non-renewal transaction type, short-rate tables
-- ============================================================

-- ALTER TYPE ADD VALUE must run outside an explicit transaction block.
-- The simple-query protocol auto-commits each statement before BEGIN.
ALTER TYPE txn_type_enum ADD VALUE IF NOT EXISTS 'NON_RENEWAL';

BEGIN;

-- ──────────────────────────────────────────────────────────────
-- 1. Quote expiry
-- ──────────────────────────────────────────────────────────────
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS expiry_date DATE;

UPDATE quotes
SET expiry_date = (effective_date + INTERVAL '60 days')::date
WHERE expiry_date IS NULL
  AND effective_date IS NOT NULL;

-- ──────────────────────────────────────────────────────────────
-- 2. Product state eligibility matrix
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_state_eligibility (
  eligibility_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT        NOT NULL,
  product_code    TEXT        NOT NULL,
  state_code      CHAR(2)     NOT NULL,
  admitted        BOOLEAN     NOT NULL DEFAULT TRUE,
  surplus_lines   BOOLEAN     NOT NULL DEFAULT FALSE,
  min_premium     NUMERIC(14,2),
  max_tiv         NUMERIC(14,2),
  max_limit       NUMERIC(14,2),
  status          TEXT        NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED','FILING_PENDING')),
  notes           TEXT,
  effective_date  DATE,
  expiration_date DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, product_code, state_code)
);

CREATE INDEX IF NOT EXISTS idx_prod_state_elig
  ON product_state_eligibility(tenant_id, product_code, state_code);

ALTER TABLE product_state_eligibility ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'product_state_eligibility' AND policyname = 'tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON product_state_eligibility
             USING (tenant_id = current_setting(''app.tenant_id''))';
  END IF;
END $$;

-- Seed sample-carrier eligibility for all 5 products across major states
INSERT INTO product_state_eligibility (tenant_id, product_code, state_code, admitted, status)
SELECT 'sample-carrier', p.product_code, s.state_code, TRUE, 'ACTIVE'
FROM (VALUES
  ('personal-auto'),('commercial-auto'),('homeowners'),
  ('cyber'),('professional-liability')
) AS p(product_code)
CROSS JOIN (VALUES
  ('AL'),('AK'),('AZ'),('AR'),('CA'),('CO'),('CT'),('DE'),('FL'),('GA'),
  ('HI'),('ID'),('IL'),('IN'),('IA'),('KS'),('KY'),('LA'),('ME'),('MD'),
  ('MA'),('MI'),('MN'),('MS'),('MO'),('MT'),('NE'),('NV'),('NH'),('NJ'),
  ('NM'),('NY'),('NC'),('ND'),('OH'),('OK'),('OR'),('PA'),('RI'),('SC'),
  ('SD'),('TN'),('TX'),('UT'),('VT'),('VA'),('WA'),('WV'),('WI'),('WY')
) AS s(state_code)
ON CONFLICT (tenant_id, product_code, state_code) DO NOTHING;

-- ──────────────────────────────────────────────────────────────
-- 3. OFAC SDN list (simplified — real list loaded via admin job)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ofac_sdn_list (
  entry_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT        NOT NULL,
  normalized_name  TEXT        NOT NULL,
  aliases          JSONB       NOT NULL DEFAULT '[]',
  address          TEXT,
  country          TEXT,
  list_type        TEXT        NOT NULL DEFAULT 'SDN',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ofac_sdn_normalized
  ON ofac_sdn_list(normalized_name text_pattern_ops);

-- OFAC screen results (one record per screening event)
CREATE TABLE IF NOT EXISTS ofac_screens (
  screen_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        TEXT        NOT NULL,
  party_name       TEXT        NOT NULL,
  policy_id        UUID,
  quote_id         UUID,
  screen_date      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result           TEXT        NOT NULL
                   CHECK (result IN ('CLEAR','POTENTIAL_HIT','CONFIRMED_HIT')),
  match_details    JSONB,
  disposition      TEXT        NOT NULL DEFAULT 'PENDING'
                   CHECK (disposition IN ('PENDING','CLEARED','ESCALATED','BLOCKED')),
  reviewed_by      UUID,
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ofac_screens_tenant
  ON ofac_screens(tenant_id, screen_date DESC);
CREATE INDEX IF NOT EXISTS idx_ofac_screens_policy
  ON ofac_screens(tenant_id, policy_id);

ALTER TABLE ofac_screens ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ofac_screens' AND policyname = 'tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON ofac_screens
             USING (tenant_id = current_setting(''app.tenant_id''))';
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────
-- 4. Policy additional interests (AI, mortgagee, loss payee, etc.)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS policy_additional_interests (
  ai_id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 TEXT        NOT NULL,
  policy_id                 UUID        NOT NULL,
  role                      TEXT        NOT NULL
                            CHECK (role IN (
                              'ADDITIONAL_INSURED',
                              'ADDITIONAL_NAMED_INSURED',
                              'LOSS_PAYEE',
                              'LOSS_PAYEE_AS_LESSOR',
                              'MORTGAGEE',
                              'ADDITIONAL_INTEREST',
                              'CERTIFICATE_HOLDER',
                              'PREMIUM_FINANCE_COMPANY'
                            )),
  -- Party info
  party_id                  UUID,
  name                      TEXT        NOT NULL,
  address                   JSONB,
  -- Additional insured details (commercial lines)
  coverage_codes            TEXT[],
  ai_form_code              TEXT,
  -- Lienholder / mortgagee details
  loan_number               TEXT,
  isaoa                     BOOLEAN     NOT NULL DEFAULT FALSE,
  atima                     BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Notification preferences
  receive_cancel_notice     BOOLEAN     NOT NULL DEFAULT TRUE,
  receive_nonrenewal_notice BOOLEAN     NOT NULL DEFAULT TRUE,
  -- Effective dating
  effective_date            DATE,
  expiration_date           DATE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_policy_ai_policy
  ON policy_additional_interests(tenant_id, policy_id);

ALTER TABLE policy_additional_interests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'policy_additional_interests' AND policyname = 'tenant_isolation'
  ) THEN
    EXECUTE 'CREATE POLICY tenant_isolation ON policy_additional_interests
             USING (tenant_id = current_setting(''app.tenant_id''))';
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────
-- 5. Cancellation reason codes
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cancellation_reason_codes (
  reason_code       TEXT    PRIMARY KEY,
  description       TEXT    NOT NULL,
  initiator         TEXT    NOT NULL CHECK (initiator IN ('INSURED','CARRIER','MUTUAL')),
  cancellation_type TEXT    NOT NULL CHECK (cancellation_type IN (
                              'FLAT','PRO_RATA','SHORT_RATE',
                              'NON_PAYMENT','UW_CANCEL','MUTUAL_CONSENT'
                            )),
  notice_days       SMALLINT NOT NULL DEFAULT 10,
  return_premium    TEXT    NOT NULL CHECK (return_premium IN ('PRO_RATA','SHORT_RATE','FLAT','NONE')),
  is_system         BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO cancellation_reason_codes
  (reason_code, description, initiator, cancellation_type, notice_days, return_premium)
VALUES
  ('INSURED_REQUEST',    'Insured requested cancellation',         'INSURED',  'SHORT_RATE',     0,  'SHORT_RATE'),
  ('NON_PAYMENT',        'Non-payment of premium',                 'CARRIER',  'NON_PAYMENT',    10, 'PRO_RATA'),
  ('MATERIAL_MISREP',    'Material misrepresentation or fraud',    'CARRIER',  'UW_CANCEL',      30, 'PRO_RATA'),
  ('RISK_CHANGE',        'Unacceptable change in risk',            'CARRIER',  'UW_CANCEL',      30, 'PRO_RATA'),
  ('FLAT_CANCEL',        'Flat cancellation — rescission',         'CARRIER',  'FLAT',           0,  'FLAT'),
  ('MUTUAL_CONSENT',     'Mutual consent of both parties',         'MUTUAL',   'MUTUAL_CONSENT', 0,  'PRO_RATA'),
  ('FRAUD',              'Fraud or intentional concealment',       'CARRIER',  'UW_CANCEL',      30, 'PRO_RATA'),
  ('UW_UNACCEPTABLE',    'Underwriting — risk not acceptable',     'CARRIER',  'UW_CANCEL',      30, 'PRO_RATA'),
  ('REPLACED_COVERAGE',  'Coverage replaced by other carrier',     'INSURED',  'SHORT_RATE',     0,  'SHORT_RATE'),
  ('PROPERTY_SOLD',      'Property sold or transferred',           'INSURED',  'SHORT_RATE',     0,  'SHORT_RATE'),
  ('VEHICLE_SOLD',       'Vehicle sold or total loss',             'INSURED',  'SHORT_RATE',     0,  'SHORT_RATE'),
  ('DECEASED',           'Named insured deceased',                 'INSURED',  'PRO_RATA',       0,  'PRO_RATA')
ON CONFLICT (reason_code) DO NOTHING;

-- Extend policy_versions with cancellation tracking
ALTER TABLE policy_versions
  ADD COLUMN IF NOT EXISTS cancellation_reason_code TEXT,
  ADD COLUMN IF NOT EXISTS cancellation_type        TEXT,
  ADD COLUMN IF NOT EXISTS return_premium_amount    NUMERIC(14,2);

-- ──────────────────────────────────────────────────────────────
-- 6. Non-renewal tracking on policies
-- ──────────────────────────────────────────────────────────────
ALTER TABLE policies
  ADD COLUMN IF NOT EXISTS non_renewed_at   DATE,
  ADD COLUMN IF NOT EXISTS non_renewal_reason TEXT;

-- ──────────────────────────────────────────────────────────────
-- 7. Short-rate factor tables (ISO standard)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS short_rate_tables (
  table_id       UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      TEXT    NOT NULL,
  product_code   TEXT,         -- NULL = applies to all products
  state_code     CHAR(2),      -- NULL = applies to all states
  -- Array of {days_from, days_to, earned_pct} objects
  table_data     JSONB   NOT NULL,
  effective_date DATE    NOT NULL DEFAULT CURRENT_DATE,
  active         BOOLEAN NOT NULL DEFAULT TRUE
);

-- Unique index supporting NULLs via COALESCE (functional index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_short_rate_tables_unique
  ON short_rate_tables (tenant_id, COALESCE(product_code,'*'), COALESCE(state_code,'*'));

-- ISO standard short-rate table seeded for sample-carrier (all products, all states)
INSERT INTO short_rate_tables (tenant_id, product_code, state_code, table_data)
VALUES (
  'sample-carrier', NULL, NULL,
  '[
    {"days_from":0,   "days_to":7,   "earned_pct":0.25},
    {"days_from":8,   "days_to":30,  "earned_pct":0.35},
    {"days_from":31,  "days_to":60,  "earned_pct":0.44},
    {"days_from":61,  "days_to":90,  "earned_pct":0.52},
    {"days_from":91,  "days_to":120, "earned_pct":0.59},
    {"days_from":121, "days_to":150, "earned_pct":0.65},
    {"days_from":151, "days_to":180, "earned_pct":0.70},
    {"days_from":181, "days_to":210, "earned_pct":0.75},
    {"days_from":211, "days_to":240, "earned_pct":0.80},
    {"days_from":241, "days_to":270, "earned_pct":0.84},
    {"days_from":271, "days_to":300, "earned_pct":0.88},
    {"days_from":301, "days_to":330, "earned_pct":0.91},
    {"days_from":331, "days_to":365, "earned_pct":0.95}
  ]'::jsonb
)
ON CONFLICT DO NOTHING;

COMMIT;
