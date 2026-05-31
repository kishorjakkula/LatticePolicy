-- Homeowners policy seed derived from external JSON sample
-- Targets the relational schema created by server/migrations/001_init.sql

BEGIN;

-- Operate under sample tenant
SELECT set_config('app.tenant_id', 'sample-carrier', false);

-- Ensure tenant and reference catalogs exist ---------------------------------
INSERT INTO tenants (tenant_id, name, default_locale, default_currency)
VALUES ('sample-carrier', 'Sample Carrier', 'en-US', 'USD')
ON CONFLICT (tenant_id) DO NOTHING;

-- Parties --------------------------------------------------------------------
INSERT INTO parties (party_id, tenant_id, type, name, org, ext)
VALUES
  ('91000000-1000-4000-8000-000000000201', 'sample-carrier', 'Person',
    '{"first":"Jordan","last":"Parker","full":"Jordan Parker"}'::jsonb, NULL, '{"externalId":"PTY-201"}'::jsonb),
  ('91000000-1000-4000-8000-000000000202', 'sample-carrier', 'Person',
    '{"first":"Reese","last":"Parker","full":"Reese Parker"}'::jsonb, NULL, '{"externalId":"PTY-202"}'::jsonb),
  ('91000000-1000-4000-8000-000000000277', 'sample-carrier', 'Person',
    '{"first":"Alex","last":"Agent","full":"Alex Agent"}'::jsonb, NULL, '{"externalId":"PTY-AGT-77"}'::jsonb),
  ('91000000-1000-4000-8000-000000000233', 'sample-carrier', 'Person',
    '{"first":"Uma","last":"Wells","full":"Uma Wells"}'::jsonb, NULL, '{"externalId":"PTY-UW-33"}'::jsonb),
  ('91000000-1000-4000-8000-000000000301', 'sample-carrier', 'Org', NULL,
    '{"legalName":"Keystone Financial","dba":"Keystone Mortgage"}'::jsonb,
    '{"externalId":"PTY-MTG-1"}'::jsonb)
ON CONFLICT (party_id) DO NOTHING;

-- Coverage definitions & forms (idempotent inserts) --------------------------
INSERT INTO coverage_definitions (definition_id, tenant_id, code, product, title, applies_to, version, limit_model, deductible_model, rating_hooks, form_hooks, ui)
VALUES
  ('bbbb2222-2222-4222-8222-222222222222', 'global', 'HO.DWELL.COVA', 'homeowners', 'Dwelling Coverage A', 'risk', '1.2.0',
   '{"schema":{"amount":"money"}}'::jsonb, '{}'::jsonb, ARRAY['compute_cov_a'], ARRAY['ISO-HO3'], '{"group":"Property","order":5}'::jsonb),
  ('bbbb2222-2222-4222-8222-222222222223', 'global', 'HO.LIAB', 'homeowners', 'Personal Liability', 'policy', '1.2.0',
   '{"schema":{"perOccurrence":"money"}}'::jsonb, '{}'::jsonb, ARRAY['compute_liab'], ARRAY['ISO-HO3'], '{"group":"Liability","order":20}'::jsonb),
  ('bbbb2222-2222-4222-8222-222222222224', 'global', 'HO.PERS.COVC', 'homeowners', 'Personal Property Coverage C', 'policy', '1.2.0',
   '{"schema":{"amount":"money"}}'::jsonb, '{}'::jsonb, ARRAY['compute_cov_c'], ARRAY['ISO-HO3'], '{"group":"Property","order":30}'::jsonb),
  ('bbbb2222-2222-4222-8222-222222222225', 'global', 'HO.LOSS.COVD', 'homeowners', 'Loss of Use Coverage D', 'policy', '1.2.0',
   '{"schema":{"amount":"money"}}'::jsonb, '{}'::jsonb, ARRAY['compute_cov_d'], ARRAY['ISO-HO3'], '{"group":"Property","order":40}'::jsonb),
  ('bbbb2222-2222-4222-8222-222222222226', 'global', 'HO.END.WATERBACKUP', 'homeowners', 'Water Backup Endorsement', 'risk', '1.0.0',
   '{"schema":{"amount":"money"}}'::jsonb, '{}'::jsonb, ARRAY['compute_water_backup'], ARRAY['STATE-PA-AMEND'], '{"group":"Endorsements","order":50}'::jsonb)
ON CONFLICT (definition_id) DO NOTHING;

INSERT INTO forms_catalog (form_id, tenant_id, code, edition, name, jurisdiction, applicability, render)
VALUES
  ('70000000-1000-4000-8000-000000009001', 'global', 'ISO-HO3', '2024-01', 'ISO HO3 Policy Jacket',
   '{"country":"US","region":"PA"}'::jsonb, '{"product":"homeowners"}'::jsonb,
   '{"templateId":"tpl-iso-ho3","dataBindings":{"insured.name":"policy.insured"}}'::jsonb),
  ('70000000-1000-4000-8000-000000009002', 'global', 'STATE-PA-AMEND', '2023-10', 'Pennsylvania Amendatory Endorsement',
   '{"country":"US","region":"PA"}'::jsonb, '{"product":"homeowners"}'::jsonb,
   '{"templateId":"tpl-pa-amend"}'::jsonb),
  ('70000000-1000-4000-8000-000000009003', 'global', 'MORTGAGEE-CLAUSE', '2022-07', 'Mortgagee Clause',
   '{"country":"US"}'::jsonb, '{"product":"homeowners"}'::jsonb,
   '{"templateId":"tpl-mortgagee-clause"}'::jsonb)
ON CONFLICT (form_id) DO NOTHING;

-- Policy core ----------------------------------------------------------------
INSERT INTO policies
  (policy_id, tenant_id, policy_number, status, product_code, product_version,
   jurisdiction_code, jurisdiction, term, term_effective_date, term_expiration_date, term_type,
   currency_code, currency, lifecycle, external_ids, insured_party_id,
   premium_summary, risk_summary, forms_summary, documents_summary, audit_log, metadata,
   created_at, updated_at)
VALUES
  ('10000000-1000-4000-8000-000000009001', 'sample-carrier', 'HO-25-19341-00011', 'Issued',
   'homeowners', '1.0',
   'PA-US', '{"country":"US","region":"PA","code":"PA-US"}'::jsonb,
   '{"effectiveDate":"2025-10-01","expirationDate":"2026-10-01","termType":"Annual"}'::jsonb,
   DATE '2025-10-01', DATE '2026-10-01', 'Annual',
   'USD', '{"code":"USD"}'::jsonb,
   '{"createdAt":"2025-09-18T17:40:00Z","createdBy":"91000000-1000-4000-8000-000000000277","issuedAt":"2025-10-01T09:10:00Z"}'::jsonb,
   '{"source":"import","policyExtId":"POL-HO-9001"}'::jsonb,
   '91000000-1000-4000-8000-000000000201',
   '{"writtenPremium":1680.00,"earnedPremium":0.00,"fees":35.00,"taxes":50.40,"discounts":-120.00,"surcharges":0.00,"total":1645.40}'::jsonb,
   '{"summary":"DW-100 primary dwelling with detached structure, liability exposures LE-1, personal property schedule PP-1"}'::jsonb,
   '{"count":3,"forms":["ISO-HO3","STATE-PA-AMEND","MORTGAGEE-CLAUSE"]}'::jsonb,
   '{"count":2,"types":["Quote","Policy"]}'::jsonb,
   '[{"at":"2025-09-18T17:40:00Z","by":"91000000-1000-4000-8000-000000000277","action":"CREATE"}, {"at":"2025-10-01T09:10:00Z","by":"91000000-1000-4000-8000-000000000233","action":"ISSUE"}]'::jsonb,
   '{"importRun":"HO-json-2025-09-07","version":"1.0"}'::jsonb,
   '2025-09-18T17:40:00Z'::timestamptz, '2026-09-01T12:00:00Z'::timestamptz)
ON CONFLICT (policy_id) DO NOTHING;

-- Parties on policy
INSERT INTO policy_parties (policy_party_id, tenant_id, policy_id, party_id, role_code, relationship, is_primary)
VALUES
  ('92000000-1000-4000-8000-000000009001', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '91000000-1000-4000-8000-000000000201', 'NamedInsured', 'Primary', true),
  ('92000000-1000-4000-8000-000000009002', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '91000000-1000-4000-8000-000000000202', 'NamedInsured', 'Spouse', false),
  ('92000000-1000-4000-8000-000000009003', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '91000000-1000-4000-8000-000000000277', 'Producer', NULL, false),
  ('92000000-1000-4000-8000-000000009004', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '91000000-1000-4000-8000-000000000233', 'Underwriter', NULL, false),
  ('92000000-1000-4000-8000-000000009005', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '91000000-1000-4000-8000-000000000301', 'Mortgagee', NULL, false)
ON CONFLICT (policy_party_id) DO NOTHING;

INSERT INTO policy_role_assignments (assignment_id, tenant_id, policy_id, party_id, role_code, permissions, scope, granted_at, granted_by, metadata)
VALUES
  ('93000000-1000-4000-8000-000000009001', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '91000000-1000-4000-8000-000000000277', 'agent', ARRAY['read','write','bind'], '{"policyId":"HO-25-19341-00011"}'::jsonb,
   '2025-09-18T17:40:00Z'::timestamptz, '91000000-1000-4000-8000-000000000233', '{"source":"import"}'::jsonb),
  ('93000000-1000-4000-8000-000000009002', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '91000000-1000-4000-8000-000000000233', 'underwriter', ARRAY['read','write','issue'], '{"policyId":"HO-25-19341-00011"}'::jsonb,
   '2025-09-18T17:41:00Z'::timestamptz, '91000000-1000-4000-8000-000000000233', '{"source":"import"}'::jsonb),
  ('93000000-1000-4000-8000-000000009003', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '91000000-1000-4000-8000-000000000301', 'billing', ARRAY['read'], '{"scope":"mortgagee"}'::jsonb,
   '2025-09-20T12:00:00Z'::timestamptz, '91000000-1000-4000-8000-000000000277', '{"source":"import"}'::jsonb)
ON CONFLICT (assignment_id) DO NOTHING;

-- Risk units -----------------------------------------------------------------
INSERT INTO risk_units (risk_unit_id, tenant_id, policy_id, transaction_id, kind, attributes, effective_date)
VALUES
  ('40000000-1000-4000-8000-000000009001', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009001', 'dwelling',
   '{"externalId":"DW-100","yearBuilt":2019,"stories":2,"sqft":3200,"construction":"Frame","roof":"Architectural Shingle","primaryResidence":true,"alarms":{"fire":true,"burglar":true}}'::jsonb,
   DATE '2025-10-01'),
  ('40000000-1000-4000-8000-000000009002', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009001', 'otherStructure',
   '{"externalId":"OS-1","description":"Detached garage with finished loft","replacementCost":65000}'::jsonb,
   DATE '2025-10-01'),
  ('40000000-1000-4000-8000-000000009003', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009001', 'liabilityExposure',
   '{"externalId":"LE-1","description":"In-ground pool with diving board","riskMitigation":["fenced","locked gate"]}'::jsonb,
   DATE '2025-10-01'),
  ('40000000-1000-4000-8000-000000009004', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009001', 'personalProperty',
   '{"externalId":"PP-1","scheduledItems":[{"item":"Jewelry","amount":25000},{"item":"Artwork","amount":15000}]}'::jsonb,
   DATE '2025-10-01')
ON CONFLICT (risk_unit_id) DO NOTHING;

INSERT INTO risk_unit_dwelling (risk_unit_id, tenant_id, address, construction, roof, roof_age_years, sqft, num_stories, occupancy, protection_class, distance_to_hydrant, heating, alarms)
VALUES
  ('40000000-1000-4000-8000-000000009001', 'sample-carrier',
   '{"line1":"143 Maple Hollow Ln","city":"Exton","state":"PA","postalCode":"19341"}'::jsonb,
   'Frame', 'Architectural Shingle', 5, 3200, 2, 'OwnerOccupied', 3, 250, 'Gas', '{"fire":true,"burglar":true}'::jsonb)
ON CONFLICT (risk_unit_id) DO NOTHING;

INSERT INTO risk_unit_other_structure (risk_unit_id, tenant_id, description, replacement_cost, metadata)
VALUES
  ('40000000-1000-4000-8000-000000009002', 'sample-carrier', 'Detached garage with loft office', 65000, '{"externalId":"OS-1"}'::jsonb)
ON CONFLICT (risk_unit_id) DO NOTHING;

INSERT INTO risk_unit_liability (risk_unit_id, tenant_id, description, exposures, metadata)
VALUES
  ('40000000-1000-4000-8000-000000009003', 'sample-carrier', 'Pool liability exposure', '{"features":["pool","divingBoard"]}'::jsonb, '{"externalId":"LE-1"}'::jsonb)
ON CONFLICT (risk_unit_id) DO NOTHING;

-- Coverages ------------------------------------------------------------------
INSERT INTO coverages
  (coverage_id, tenant_id, policy_id, transaction_id, risk_ref, applies_to, definition_code, limits, deductibles, options, effective_date)
VALUES
  ('50000000-1000-4000-8000-000000009001', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009001', '40000000-1000-4000-8000-000000009001', 'risk', 'HO.DWELL.COVA',
   '{"amount":550000}'::jsonb, '{"amount":1000}'::jsonb, NULL, DATE '2025-10-01'),
  ('50000000-1000-4000-8000-000000009002', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009001', '10000000-1000-4000-8000-000000009001', 'policy', 'HO.LIAB',
   '{"perOccurrence":500000}'::jsonb, '{}'::jsonb, NULL, DATE '2025-10-01'),
  ('50000000-1000-4000-8000-000000009003', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009001', '10000000-1000-4000-8000-000000009001', 'policy', 'HO.PERS.COVC',
   '{"amount":275000}'::jsonb, '{}'::jsonb, NULL, DATE '2025-10-01'),
  ('50000000-1000-4000-8000-000000009004', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009001', '10000000-1000-4000-8000-000000009001', 'policy', 'HO.LOSS.COVD',
   '{"amount":110000}'::jsonb, '{}'::jsonb, NULL, DATE '2025-10-01'),
  ('50000000-1000-4000-8000-000000009005', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009001', '40000000-1000-4000-8000-000000009001', 'risk', 'HO.END.WATERBACKUP',
   '{"amount":10000}'::jsonb, '{}'::jsonb, NULL, DATE '2025-10-01')
ON CONFLICT (coverage_id) DO NOTHING;

INSERT INTO coverage_selections (selection_id, tenant_id, policy_id, version_id, coverage_code, selected, limit_value, deductible, percent)
VALUES
  ('60000000-1000-4000-8000-000000009001', 'sample-carrier', '10000000-1000-4000-8000-000000009001', 'a1000000-1000-4000-8000-000000009001', 'HO.DWELL.COVA', true, 550000, 1000, NULL),
  ('60000000-1000-4000-8000-000000009002', 'sample-carrier', '10000000-1000-4000-8000-000000009001', 'a1000000-1000-4000-8000-000000009001', 'HO.LIAB', true, 500000, NULL, NULL),
  ('60000000-1000-4000-8000-000000009003', 'sample-carrier', '10000000-1000-4000-8000-000000009001', 'a1000000-1000-4000-8000-000000009001', 'HO.PERS.COVC', true, 275000, NULL, NULL),
  ('60000000-1000-4000-8000-000000009004', 'sample-carrier', '10000000-1000-4000-8000-000000009001', 'a1000000-1000-4000-8000-000000009001', 'HO.LOSS.COVD', true, 110000, NULL, NULL),
  ('60000000-1000-4000-8000-000000009005', 'sample-carrier', '10000000-1000-4000-8000-000000009001', 'a1000000-1000-4000-8000-000000009001', 'HO.END.WATERBACKUP', true, 10000, NULL, NULL)
ON CONFLICT (selection_id) DO NOTHING;

-- Transactions ---------------------------------------------------------------
INSERT INTO policy_transactions
  (transaction_id, tenant_id, policy_id, type, status, jurisdiction, term,
   requested_changes, snapshot, rating_id, uw, notes, forms, documents, metadata,
   created_at, created_by)
VALUES
  ('20000000-1000-4000-8000-000000009001', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   'NB', 'Issued',
   '{"code":"PA-US","ratingDate":"2025-09-20"}'::jsonb,
   '{"effectiveDate":"2025-10-01","expirationDate":"2026-10-01"}'::jsonb,
   '[]'::jsonb,
   '{"premium":{"total":{"amount":1645.40,"currency":"USD"}},"risk":{"dwelling":"DW-100"}}'::jsonb,
   '30000000-1000-4000-8000-000000009001',
   '{"decision":"Approve","decidedBy":"91000000-1000-4000-8000-000000000233","decidedAt":"2025-09-21T10:00:00Z"}'::jsonb,
   '["82000000-1000-4000-8000-000000009001"]'::jsonb,
   '["70000000-1000-4000-8000-000000009001","70000000-1000-4000-8000-000000009002","70000000-1000-4000-8000-000000009003"]'::jsonb,
   '["71000000-1000-4000-8000-000000009001","71000000-1000-4000-8000-000000009002"]'::jsonb,
   '{"source":"json-import"}'::jsonb,
   '2025-09-20T13:20:00Z'::timestamptz, '91000000-1000-4000-8000-000000000277'),
  ('20000000-1000-4000-8000-000000009002', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   'ENDORSE', 'Issued',
   '{"code":"PA-US","ratingDate":"2026-01-10"}'::jsonb,
   '{"effectiveDate":"2026-01-15","expirationDate":"2026-10-01"}'::jsonb,
   '[{"path":"/risk_units/dwelling/roof","from":"Architectural Shingle","to":"Metal"},{"path":"/coverages/HO.DWELL.COVA/limits/amount","from":550000,"to":575000}]'::jsonb,
   '{"premiumDelta":{"amount":46.35,"currency":"USD"}}'::jsonb,
   '30000000-1000-4000-8000-000000009002',
   '{"decision":"AutoApproved"}'::jsonb,
   '["82000000-1000-4000-8000-000000009002"]'::jsonb,
   '["70000000-1000-4000-8000-000000009002"]'::jsonb,
   '["71000000-1000-4000-8000-000000009002"]'::jsonb,
   '{"changeOrder":"CO-2026-01-12"}'::jsonb,
   '2026-01-12T09:00:00Z'::timestamptz, '91000000-1000-4000-8000-000000000277'),
  ('20000000-1000-4000-8000-000000009003', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   'CANCEL', 'Issued',
   '{"code":"PA-US","ratingDate":"2026-04-01"}'::jsonb,
   '{"effectiveDate":"2026-04-15","expirationDate":"2026-10-01"}'::jsonb,
   '[{"path":"/status","from":"Issued","to":"Cancelled"}]'::jsonb,
   '{"returnPremium":{"amount":600.00,"currency":"USD"}}'::jsonb,
   '30000000-1000-4000-8000-000000009003',
   '{"decision":"Cancel","reason":"NonPay"}'::jsonb,
   '["82000000-1000-4000-8000-000000009003"]'::jsonb,
   '[]'::jsonb,
   '["71000000-1000-4000-8000-000000009002"]'::jsonb,
   '{"notice":"CN-2026-04-01"}'::jsonb,
   '2026-04-01T08:15:00Z'::timestamptz, '91000000-1000-4000-8000-000000000277'),
  ('20000000-1000-4000-8000-000000009004', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   'REINSTATE', 'Issued',
   '{"code":"PA-US","ratingDate":"2026-04-20"}'::jsonb,
   '{"effectiveDate":"2026-04-21","expirationDate":"2026-10-01"}'::jsonb,
   '[{"path":"/status","from":"Cancelled","to":"Issued"}]'::jsonb,
   '{"reinstatementFee":{"amount":20.60,"currency":"USD"}}'::jsonb,
   '30000000-1000-4000-8000-000000009004',
   '{"decision":"Approve","decidedBy":"91000000-1000-4000-8000-000000000233"}'::jsonb,
   '["82000000-1000-4000-8000-000000009004"]'::jsonb,
   '["70000000-1000-4000-8000-000000009002"]'::jsonb,
   '["71000000-1000-4000-8000-000000009002"]'::jsonb,
   '{"paymentPlan":"Reinstate"}'::jsonb,
   '2026-04-21T09:05:00Z'::timestamptz, '91000000-1000-4000-8000-000000000233'),
  ('20000000-1000-4000-8000-000000009005', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   'REWRITE', 'Issued',
   '{"code":"PA-US","ratingDate":"2026-07-01"}'::jsonb,
   '{"effectiveDate":"2026-07-05","expirationDate":"2027-07-05"}'::jsonb,
   '[{"path":"/externalIds/rewriteOf","to":"POL-HO-9001"}]'::jsonb,
   '{"rewrite":{"amount":77.25,"currency":"USD"}}'::jsonb,
   '30000000-1000-4000-8000-000000009005',
   '{"decision":"Approve"}'::jsonb,
   '["82000000-1000-4000-8000-000000009005"]'::jsonb,
   '["70000000-1000-4000-8000-000000009001","70000000-1000-4000-8000-000000009002"]'::jsonb,
   '["71000000-1000-4000-8000-000000009002"]'::jsonb,
   '{"newPolicyNumber":"HO-26-19341-00011"}'::jsonb,
   '2026-07-01T14:10:00Z'::timestamptz, '91000000-1000-4000-8000-000000000277'),
  ('20000000-1000-4000-8000-000000009006', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   'RENEW', 'Issued',
   '{"code":"PA-US","ratingDate":"2026-09-01"}'::jsonb,
   '{"effectiveDate":"2026-10-01","expirationDate":"2027-10-01"}'::jsonb,
   '[{"path":"/term/effectiveDate","from":"2025-10-01","to":"2026-10-01"}]'::jsonb,
   '{"renewalPremium":{"amount":1699.50,"currency":"USD"}}'::jsonb,
   '30000000-1000-4000-8000-000000009006',
   '{"decision":"Approve","decidedAt":"2026-09-15T09:00:00Z"}'::jsonb,
   '["82000000-1000-4000-8000-000000009006"]'::jsonb,
   '["70000000-1000-4000-8000-000000009001","70000000-1000-4000-8000-000000009002","70000000-1000-4000-8000-000000009003"]'::jsonb,
   '["71000000-1000-4000-8000-000000009002"]'::jsonb,
   '{"renewalBatch":"2026-Renewal-PA"}'::jsonb,
   '2026-09-01T08:00:00Z'::timestamptz, '91000000-1000-4000-8000-000000000277')
ON CONFLICT (transaction_id) DO NOTHING;

INSERT INTO policy_forms (policy_form_id, tenant_id, policy_id, transaction_id, form_id, code, metadata)
VALUES
  ('72000000-1000-4000-8000-000000009001', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009001', '70000000-1000-4000-8000-000000009001', 'ISO-HO3',
   '{"source":"json-import","sequence":1}'::jsonb),
  ('72000000-1000-4000-8000-000000009002', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009001', '70000000-1000-4000-8000-000000009002', 'STATE-PA-AMEND',
   '{"source":"json-import","sequence":2}'::jsonb),
  ('72000000-1000-4000-8000-000000009003', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009001', '70000000-1000-4000-8000-000000009003', 'MORTGAGEE-CLAUSE',
   '{"source":"json-import","sequence":3}'::jsonb),
  ('72000000-1000-4000-8000-000000009004', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009002', '70000000-1000-4000-8000-000000009002', 'STATE-PA-AMEND',
   '{"source":"json-import","sequence":1}'::jsonb),
  ('72000000-1000-4000-8000-000000009005', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009004', '70000000-1000-4000-8000-000000009002', 'STATE-PA-AMEND',
   '{"source":"json-import","sequence":1}'::jsonb),
  ('72000000-1000-4000-8000-000000009006', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009005', '70000000-1000-4000-8000-000000009001', 'ISO-HO3',
   '{"source":"json-import","sequence":1}'::jsonb),
  ('72000000-1000-4000-8000-000000009007', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009005', '70000000-1000-4000-8000-000000009002', 'STATE-PA-AMEND',
   '{"source":"json-import","sequence":2}'::jsonb),
  ('72000000-1000-4000-8000-000000009008', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009006', '70000000-1000-4000-8000-000000009001', 'ISO-HO3',
   '{"source":"json-import","sequence":1}'::jsonb),
  ('72000000-1000-4000-8000-000000009009', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009006', '70000000-1000-4000-8000-000000009002', 'STATE-PA-AMEND',
   '{"source":"json-import","sequence":2}'::jsonb),
  ('72000000-1000-4000-8000-000000009010', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009006', '70000000-1000-4000-8000-000000009003', 'MORTGAGEE-CLAUSE',
   '{"source":"json-import","sequence":3}'::jsonb)
ON CONFLICT (policy_form_id) DO NOTHING;

-- Documents ------------------------------------------------------------------
INSERT INTO documents (document_id, tenant_id, policy_id, transaction_id, type, uri, hash, metadata, created_at, created_by)
VALUES
  ('71000000-1000-4000-8000-000000009001', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009001', 'Quote',
   's3://pas/HO-25-19341-00011/quote.pdf', NULL,
   '{"sourceId":"DOC-HO-Q-0001"}'::jsonb,
   '2025-09-20T13:20:00Z'::timestamptz, '91000000-1000-4000-8000-000000000277'),
  ('71000000-1000-4000-8000-000000009002', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009001', 'Policy',
   's3://pas/HO-25-19341-00011/policy_2025-10-01.pdf', NULL,
   '{"sourceId":"DOC-HO-P-0001"}'::jsonb,
   '2025-10-01T09:10:00Z'::timestamptz, '91000000-1000-4000-8000-000000000233')
ON CONFLICT (document_id) DO NOTHING;

-- Notes ----------------------------------------------------------------------
INSERT INTO notes (note_id, tenant_id, transaction_id, note_type, note_text, visibility, added_by, metadata)
VALUES
  ('82000000-1000-4000-8000-000000009001', 'sample-carrier', '20000000-1000-4000-8000-000000009001',
   'System', 'Imported NB transaction from HO JSON payload; policy issued immediately.', ARRAY['Agent','Underwriter'],
   '91000000-1000-4000-8000-000000000277', '{"source":"json-import"}'::jsonb),
  ('82000000-1000-4000-8000-000000009002', 'sample-carrier', '20000000-1000-4000-8000-000000009002',
   'UW', 'Roof upgrade endorsement approved; Coverage A increased to 575000.', ARRAY['Underwriter','Agent'],
   '91000000-1000-4000-8000-000000000233', '{"source":"json-import"}'::jsonb),
  ('82000000-1000-4000-8000-000000009003', 'sample-carrier', '20000000-1000-4000-8000-000000009003',
   'Billing', 'Cancellation for non-payment effective 2026-04-15.', ARRAY['Billing','Agent'],
   '91000000-1000-4000-8000-000000000277', '{"source":"json-import"}'::jsonb),
  ('82000000-1000-4000-8000-000000009004', 'sample-carrier', '20000000-1000-4000-8000-000000009004',
   'Billing', 'Payment posted and policy reinstated without lapse.', ARRAY['Billing','Underwriter'],
   '91000000-1000-4000-8000-000000000233', '{"source":"json-import"}'::jsonb),
  ('82000000-1000-4000-8000-000000009005', 'sample-carrier', '20000000-1000-4000-8000-000000009005',
   'Operations', 'Rewrite issued to maintain coverage; new policy number HO-26-19341-00011.', ARRAY['Operations','Agent'],
   '91000000-1000-4000-8000-000000000277', '{"source":"json-import"}'::jsonb),
  ('82000000-1000-4000-8000-000000009006', 'sample-carrier', '20000000-1000-4000-8000-000000009006',
   'Renewal', 'Renewal accepted for 2026-10-01 term at 1,699.50 total premium.', ARRAY['Renewal','Agent'],
   '91000000-1000-4000-8000-000000000277', '{"source":"json-import"}'::jsonb)
ON CONFLICT (note_id) DO NOTHING;

-- Ledger events --------------------------------------------------------------
INSERT INTO ledger_events (event_id, tenant_id, entity_type, entity_id, event, from_state, to_state, payload, occurred_at, actor)
VALUES
  ('73000000-1000-4000-8000-000000009001', 'sample-carrier', 'Policy', '10000000-1000-4000-8000-000000009001',
   'POLICY_STATUS_CHANGE', 'Quote', 'Issued',
   '{"transactionId":"20000000-1000-4000-8000-000000009001","policyNumber":"HO-25-19341-00011"}'::jsonb,
   '2025-10-01T09:10:00Z'::timestamptz, '91000000-1000-4000-8000-000000000233'),
  ('73000000-1000-4000-8000-000000009002', 'sample-carrier', 'Policy', '10000000-1000-4000-8000-000000009001',
   'TRANSACTION_COMPLETED', 'Issued', 'Issued',
   '{"transactionId":"20000000-1000-4000-8000-000000009002","type":"ENDORSE","premiumDelta":46.35}'::jsonb,
   '2026-01-12T09:00:00Z'::timestamptz, '91000000-1000-4000-8000-000000000277'),
  ('73000000-1000-4000-8000-000000009003', 'sample-carrier', 'Policy', '10000000-1000-4000-8000-000000009001',
   'POLICY_STATUS_CHANGE', 'Issued', 'Cancelled',
   '{"transactionId":"20000000-1000-4000-8000-000000009003","reason":"NonPay"}'::jsonb,
   '2026-04-01T08:15:00Z'::timestamptz, '91000000-1000-4000-8000-000000000277'),
  ('73000000-1000-4000-8000-000000009004', 'sample-carrier', 'Policy', '10000000-1000-4000-8000-000000009001',
   'POLICY_STATUS_CHANGE', 'Cancelled', 'Issued',
   '{"transactionId":"20000000-1000-4000-8000-000000009004","reason":"Payment received"}'::jsonb,
   '2026-04-21T09:05:00Z'::timestamptz, '91000000-1000-4000-8000-000000000233'),
  ('73000000-1000-4000-8000-000000009005', 'sample-carrier', 'Policy', '10000000-1000-4000-8000-000000009001',
   'TRANSACTION_REWRITE', 'Issued', 'Issued',
   '{"transactionId":"20000000-1000-4000-8000-000000009005","newPolicyNumber":"HO-26-19341-00011"}'::jsonb,
   '2026-07-01T14:10:00Z'::timestamptz, '91000000-1000-4000-8000-000000000277'),
  ('73000000-1000-4000-8000-000000009006', 'sample-carrier', 'Policy', '10000000-1000-4000-8000-000000009001',
   'POLICY_STATUS_CHANGE', 'Issued', 'Issued',
   '{"transactionId":"20000000-1000-4000-8000-000000009006","termEffective":"2026-10-01"}'::jsonb,
   '2026-09-01T08:00:00Z'::timestamptz, '91000000-1000-4000-8000-000000000277')
ON CONFLICT (event_id) DO NOTHING;

-- Policy versions & change tracking -----------------------------------------
INSERT INTO policy_versions
  (version_id, tenant_id, policy_id, transaction_id, effective_date, processed_at, transaction_type,
   premium_summary, currency_code, uw_decision, uw_override, override_reason, payload)
VALUES
  ('a1000000-1000-4000-8000-000000009001', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009001', DATE '2025-10-01', '2025-10-01T09:10:00Z'::timestamptz, 'NB',
   '{"total":{"amount":1645.40,"currency":"USD"}}'::jsonb, 'USD', 'Approve', false, NULL,
   '{"status":"Issued","coverages":{"HO.DWELL.COVA":550000,"HO.LIAB":500000,"HO.PERS.COVC":275000,"HO.LOSS.COVD":110000,"HO.END.WATERBACKUP":10000}}'::jsonb),
  ('a1000000-1000-4000-8000-000000009002', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009002', DATE '2026-01-15', '2026-01-12T09:05:00Z'::timestamptz, 'ENDORSE',
   '{"delta":{"amount":46.35,"currency":"USD"}}'::jsonb, 'USD', 'AutoApproved', false, NULL,
   '{"coverages":{"HO.DWELL.COVA":575000},"risk":{"dwelling":{"roof":"Metal"}}}'::jsonb),
  ('a1000000-1000-4000-8000-000000009003', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009003', DATE '2026-04-15', '2026-04-01T08:20:00Z'::timestamptz, 'CANCEL',
   '{"return":{"amount":600.00,"currency":"USD"}}'::jsonb, 'USD', 'Cancel', false, 'NonPay',
   '{"status":"Cancelled","reason":"NonPay"}'::jsonb),
  ('a1000000-1000-4000-8000-000000009004', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009004', DATE '2026-04-21', '2026-04-21T09:06:00Z'::timestamptz, 'REINSTATE',
   '{"fees":{"amount":20.60,"currency":"USD"}}'::jsonb, 'USD', 'Approve', true, 'Payment received',
   '{"status":"Issued"}'::jsonb),
  ('a1000000-1000-4000-8000-000000009005', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009005', DATE '2026-07-05', '2026-07-01T14:15:00Z'::timestamptz, 'REWRITE',
   '{"delta":{"amount":77.25,"currency":"USD"}}'::jsonb, 'USD', 'Approve', false, NULL,
   '{"rewrite":{"of":"POL-HO-9001","newPolicyNumber":"HO-26-19341-00011"}}'::jsonb),
  ('a1000000-1000-4000-8000-000000009006', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009006', DATE '2026-10-01', '2026-09-15T09:05:00Z'::timestamptz, 'RENEW',
   '{"total":{"amount":1699.50,"currency":"USD"}}'::jsonb, 'USD', 'Approve', false, NULL,
   '{"term":{"effectiveDate":"2026-10-01","expirationDate":"2027-10-01"},"coverages":{"HO.LIAB":500000}}'::jsonb)
ON CONFLICT (version_id) DO NOTHING;

INSERT INTO policy_version_changes (tenant_id, policy_id, version_id, path, old, new)
VALUES
  ('sample-carrier', '10000000-1000-4000-8000-000000009001', 'a1000000-1000-4000-8000-000000009002',
   '/coverages/HO.DWELL.COVA/limits/amount', '550000', '575000'),
  ('sample-carrier', '10000000-1000-4000-8000-000000009001', 'a1000000-1000-4000-8000-000000009002',
   '/risk/dwelling/roof', '"Architectural Shingle"', '"Metal"'),
  ('sample-carrier', '10000000-1000-4000-8000-000000009001', 'a1000000-1000-4000-8000-000000009003',
   '/status', '"Issued"', '"Cancelled"'),
  ('sample-carrier', '10000000-1000-4000-8000-000000009001', 'a1000000-1000-4000-8000-000000009004',
   '/status', '"Cancelled"', '"Issued"'),
  ('sample-carrier', '10000000-1000-4000-8000-000000009001', 'a1000000-1000-4000-8000-000000009006',
   '/term/effectiveDate', '"2025-10-01"', '"2026-10-01"')
ON CONFLICT DO NOTHING;

-- Ratings --------------------------------------------------------------------
INSERT INTO ratings
  (rating_id, tenant_id, policy_id, transaction_id, inputs, components, discounts, surcharges, taxes, total_premium, currency_code, calc_trace)
VALUES
  ('30000000-1000-4000-8000-000000009001', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009001',
   '{"ratingFactors":{"construction":"Frame","protectionClass":3,"yearBuilt":2019},"tablesVersion":"HO-2025Q3"}'::jsonb,
   '[{"code":"BASE","amount":{"value":1600.00,"currency":"USD"}},{"code":"FEE","amount":{"value":35.00,"currency":"USD"}}]'::jsonb,
   '[{"code":"ALARM","amount":{"value":120.00,"currency":"USD"}}]'::jsonb,
   '[]'::jsonb,
   '[{"code":"PREMIUM_TAX","amount":{"value":50.40,"currency":"USD"},"rate":0.03}]'::jsonb,
   1645.40, 'USD',
   '[{"step":1,"expr":"Base premium lookup","value":1600.00},{"step":2,"expr":"Add policy fee","value":35.00},{"step":3,"expr":"Apply discounts","value":-120.00},{"step":4,"expr":"Apply tax 3%","value":50.40}]'::jsonb),
  ('30000000-1000-4000-8000-000000009002', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009002',
   '{"ratingFactors":{"roofYear":2025},"tablesVersion":"HO-2026Q1"}'::jsonb,
   '[{"code":"ENDORSE_ADJ","amount":{"value":45.00,"currency":"USD"}}]'::jsonb,
   '[]'::jsonb,
   '[]'::jsonb,
   '[{"code":"PREMIUM_TAX","amount":{"value":1.35,"currency":"USD"},"rate":0.03}]'::jsonb,
   46.35, 'USD',
   '[{"step":1,"expr":"Endorsement adjustment","value":45.00},{"step":2,"expr":"Tax 3%","value":1.35}]'::jsonb),
  ('30000000-1000-4000-8000-000000009003', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009003',
   '{"ratingFactors":{"cancelProRata":true}}'::jsonb,
   '[{"code":"RETURN_PREMIUM","amount":{"value":-600.00,"currency":"USD"}}]'::jsonb,
   '[]'::jsonb,
   '[]'::jsonb,
   '[]'::jsonb,
   -600.00, 'USD',
   '[{"step":1,"expr":"Pro-rata return","value":-600.00}]'::jsonb),
  ('30000000-1000-4000-8000-000000009004', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009004',
   '{"ratingFactors":{"reinstatementFee":20.00}}'::jsonb,
   '[{"code":"FEE","amount":{"value":20.00,"currency":"USD"}}]'::jsonb,
   '[]'::jsonb,
   '[]'::jsonb,
   '[{"code":"PREMIUM_TAX","amount":{"value":0.60,"currency":"USD"},"rate":0.03}]'::jsonb,
   20.60, 'USD',
   '[{"step":1,"expr":"Reinstatement fee","value":20.00},{"step":2,"expr":"Tax 3%","value":0.60}]'::jsonb),
  ('30000000-1000-4000-8000-000000009005', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
   '20000000-1000-4000-8000-000000009005',
   '{"ratingFactors":{"materialChange":true}}'::jsonb,
   '[{"code":"REWRITE_ADJ","amount":{"value":75.00,"currency":"USD"}}]'::jsonb,
   '[]'::jsonb,
   '[]'::jsonb,
   '[{"code":"PREMIUM_TAX","amount":{"value":2.25,"currency":"USD"},"rate":0.03}]'::jsonb,
   77.25, 'USD',
   '[{"step":1,"expr":"Rewrite adjustment","value":75.00},{"step":2,"expr":"Tax 3%","value":2.25}]'::jsonb),
  ('30000000-1000-4000-8000-000000009006', 'sample-carrier', '10000000-1000-4000-8000-000000009001',
  '20000000-1000-4000-8000-000000009006',
   '{"ratingFactors":{"liabilityLimit":1000000},"tablesVersion":"HO-2026Q3"}'::jsonb,
   '[{"code":"RENEW_BASE","amount":{"value":1700.00,"currency":"USD"}}]'::jsonb,
   '[{"code":"LOYALTY","amount":{"value":50.00,"currency":"USD"}}]'::jsonb,
   '[]'::jsonb,
   '[{"code":"PREMIUM_TAX","amount":{"value":49.50,"currency":"USD"},"rate":0.03}]'::jsonb,
   1699.50, 'USD',
   '[{"step":1,"expr":"Base renewal premium","value":1700.00},{"step":2,"expr":"Loyalty credit","value":-50.00},{"step":3,"expr":"Tax 3%","value":49.50}]'::jsonb)
ON CONFLICT (rating_id) DO NOTHING;

COMMIT;
