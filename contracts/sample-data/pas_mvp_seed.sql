-- Sample relational seed data for the PAS MVP (Postgres 15+)
-- Applies to the schema defined in server/migrations/001_init.sql.

BEGIN;

-- Ensure RLS policies permit writes for this session.
SELECT set_config('app.tenant_id', 'sample-carrier', false);

-- Tenants ------------------------------------------------------------------
INSERT INTO tenants (tenant_id, name, default_locale, default_currency)
VALUES ('sample-carrier', 'Sample Carrier', 'en-US', 'USD')
ON CONFLICT (tenant_id) DO NOTHING;

-- Parties ------------------------------------------------------------------
INSERT INTO parties (party_id, tenant_id, type, name, created_at, updated_at)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'sample-carrier', 'Person', '{"first":"Taylor","last":"Reed","full":"Taylor Reed"}', now(), now()),
  ('22222222-2222-4222-8222-222222222222', 'sample-carrier', 'Person', '{"first":"Morgan","last":"Reed","full":"Morgan Reed"}', now(), now()),
  ('33333333-3333-4333-8333-333333333333', 'sample-carrier', 'Person', '{"first":"Alex","last":"Agent","full":"Alex Agent"}', now(), now()),
  ('44444444-4444-4444-8444-444444444444', 'sample-carrier', 'Person', '{"first":"Uma","last":"Wright","full":"Uma Wright"}', now(), now()),
  ('55555555-5555-4555-8555-555555555555', 'sample-carrier', 'Org', '{"full":"First National Bank"}', now(), now())
ON CONFLICT (party_id) DO NOTHING;

-- Reference catalogs -------------------------------------------------------
INSERT INTO jurisdictions (jurisdiction_id, tenant_id, code, country, region, currency, tax, compliance)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0', 'global', 'PA-US', 'US', 'PA', 'USD',
        '{"premiumTaxRate":0.03}'::jsonb, '{"noticeDays":{"cancel":30,"nonrenew":60}}'::jsonb)
ON CONFLICT (jurisdiction_id) DO NOTHING;

INSERT INTO jurisdictions (jurisdiction_id, tenant_id, code, country, region, currency, tax, compliance)
VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0', 'global', 'CA-US', 'US', 'CA', 'USD',
        '{"premiumTaxRate":0.025}'::jsonb, '{"noticeDays":{"cancel":45,"nonrenew":60}}'::jsonb)
ON CONFLICT (jurisdiction_id) DO NOTHING;

INSERT INTO coverage_definitions (definition_id, tenant_id, code, product_code, title, applies_to, version, limit_model, deductible_model, rating_hooks, form_hooks, ui)
VALUES
  ('aaaa1111-1111-4111-8111-111111111111', 'global', 'PA.LIAB.BI', 'personal-auto', 'Bodily Injury Liability', 'policy', '1.0.0',
   '{"schema":{"perPerson":"money","perAccident":"money"}}'::jsonb, '{}'::jsonb, ARRAY['compute_bi_premium'], ARRAY['ISO-PP0001'], '{"group":"Liability","order":10}'::jsonb),
  ('aaaa1111-1111-4111-8111-111111111112', 'global', 'PA.LIAB.PD', 'personal-auto', 'Property Damage Liability', 'policy', '1.0.0',
   '{"schema":{"perAccident":"money"}}'::jsonb, '{}'::jsonb, ARRAY['compute_pd_premium'], ARRAY['ISO-PP0001'], '{"group":"Liability","order":20}'::jsonb),
  ('aaaa1111-1111-4111-8111-111111111113', 'global', 'PA.PHY.COMP', 'personal-auto', 'Comprehensive', 'vehicle', '1.0.0',
   '{}'::jsonb, '{"schema":{"amount":"money"}}'::jsonb, ARRAY['compute_comp_premium'], ARRAY['ISO-PP0001'], '{"group":"Physical Damage","order":30}'::jsonb),
  ('bbbb2222-2222-4222-8222-222222222222', 'global', 'HO.DWELL.COVA', 'homeowners', 'Dwelling Coverage A', 'risk', '1.2.0',
   '{"schema":{"amount":"money"}}'::jsonb, '{}'::jsonb, ARRAY['compute_cov_a'], ARRAY['ISO-HO3'], '{"group":"Property","order":5}'::jsonb),
  ('bbbb2222-2222-4222-8222-222222222223', 'global', 'HO.LIAB', 'homeowners', 'Personal Liability', 'policy', '1.2.0',
   '{"schema":{"perOccurrence":"money"}}'::jsonb, '{}'::jsonb, ARRAY['compute_liab'], ARRAY['ISO-HO3'], '{"group":"Liability","order":20}'::jsonb)
ON CONFLICT (definition_id) DO NOTHING;

INSERT INTO forms_catalog (form_id, tenant_id, code, edition, name, jurisdiction, applicability, render, metadata)
VALUES
  ('form-pa-iso-pp0001', 'global', 'ISO-PP0001', '2024-01', 'ISO Personal Auto Policy', '{"country":"US","region":"PA"}'::jsonb,
   '{"product":"personal-auto","rules":["coverage(\"PA.LIAB.BI\").selected = true"]}'::jsonb,
   '{"templateId":"tpl-iso-pp0001","dataBindings":{"insured.name":"policy.insured"}}'::jsonb, NULL),
  ('form-pa-um', 'global', 'STATE-PA-UMSELECTION', '2024-01', 'Pennsylvania UM/UIM Selection', '{"country":"US","region":"PA"}'::jsonb,
   '{"product":"personal-auto"}'::jsonb,
   '{"templateId":"tpl-pa-um","dataBindings":{}}'::jsonb, NULL),
  ('form-ho-iso-ho3', 'global', 'ISO-HO3', '2024-04', 'ISO Homeowners Policy', '{"country":"US","region":"CA"}'::jsonb,
   '{"product":"homeowners"}'::jsonb,
   '{"templateId":"tpl-iso-ho3"}'::jsonb, NULL)
ON CONFLICT (form_id) DO NOTHING;

INSERT INTO field_meta (meta_id, tenant_id, path, type, enum_values, required, visible_to, editable_by, validation, i18n, ui)
VALUES
  ('meta-vehicle-usage', 'global', 'risk.auto_vehicle.usage', 'enum',
   ARRAY['pleasure','commute','business'], true,
   ARRAY['agent','underwriter'], ARRAY['agent','underwriter'],
   '{"when":"product_code = ''personal-auto''","message":"Usage is required"}'::jsonb,
   '{"labelKey":"vehicle.use","helpKey":"vehicle.use.help"}'::jsonb,
   '{"widget":"select","order":120,"group":"Vehicle"}'::jsonb)
ON CONFLICT (meta_id) DO NOTHING;

-- Policy: Personal Auto ----------------------------------------------------
INSERT INTO policies
  (policy_id, tenant_id, policy_number, status, product_code, product_version,
   jurisdiction_code, term_effective_date, term_expiration_date, term_type,
   currency_code, insured_party_id, premium_summary, lifecycle, external_ids, metadata)
VALUES
  ('aaaa0000-0000-4000-8000-00000000a001', 'sample-carrier', 'PA-2025-0001', 'Issued',
   'personal-auto', '1.0.0', 'PA-US', DATE '2025-10-01', DATE '2026-10-01', 'Annual',
   'USD', '11111111-1111-4111-8111-111111111111',
   '{"total":{"amount":872.25,"currency":"USD"},"fees":{"amount":25,"currency":"USD"},"taxes":{"amount":24.75,"currency":"USD"}}'::jsonb,
   '{"createdAt":"2025-09-20T14:22:05Z","createdBy":"33333333-3333-4333-8333-333333333333","issuedAt":"2025-09-22T10:15:42Z"}'::jsonb,
   '{"legacy":"LEG-10001","carrier":"CR-PA-0001"}'::jsonb,
   '{"projectionVersion":3}'::jsonb)
ON CONFLICT (policy_id) DO NOTHING;

INSERT INTO policy_parties (policy_party_id, tenant_id, policy_id, party_id, role_code, relationship, is_primary)
VALUES
  ('aaaa0000-0000-4000-8000-00000000b101', 'sample-carrier', 'aaaa0000-0000-4000-8000-00000000a001', '11111111-1111-4111-8111-111111111111', 'NamedInsured', 'Primary', true),
  ('aaaa0000-0000-4000-8000-00000000b102', 'sample-carrier', 'aaaa0000-0000-4000-8000-00000000a001', '22222222-2222-4222-8222-222222222222', 'AdditionalDriver', NULL, false),
  ('aaaa0000-0000-4000-8000-00000000b103', 'sample-carrier', 'aaaa0000-0000-4000-8000-00000000a001', '33333333-3333-4333-8333-333333333333', 'Producer', NULL, false),
  ('aaaa0000-0000-4000-8000-00000000b104', 'sample-carrier', 'aaaa0000-0000-4000-8000-00000000a001', '44444444-4444-4444-8444-444444444444', 'Underwriter', NULL, false)
ON CONFLICT (policy_party_id) DO NOTHING;

INSERT INTO policy_role_assignments (assignment_id, tenant_id, policy_id, party_id, role_code, permissions, granted_at, granted_by)
VALUES
  ('aaaa0000-0000-4000-8000-00000000c101', 'sample-carrier', 'aaaa0000-0000-4000-8000-00000000a001', '33333333-3333-4333-8333-333333333333', 'agent', ARRAY['read','write','bind'], now(), '44444444-4444-4444-8444-444444444444'),
  ('aaaa0000-0000-4000-8000-00000000c102', 'sample-carrier', 'aaaa0000-0000-4000-8000-00000000a001', '44444444-4444-4444-8444-444444444444', 'underwriter', ARRAY['read','write','issue'], now(), '44444444-4444-4444-8444-444444444444')
ON CONFLICT (assignment_id) DO NOTHING;

INSERT INTO policy_transactions
  (transaction_id, tenant_id, policy_id, type, status, jurisdiction, term,
   requested_changes, snapshot, rating_id, uw, notes, forms, documents, created_at, created_by, metadata)
VALUES
  ('bbbb0000-0000-4000-8000-00000000d001', 'sample-carrier', 'aaaa0000-0000-4000-8000-00000000a001',
   'NB', 'Issued',
   '{"code":"PA-US","ratingDate":"2025-09-21"}'::jsonb,
   '{"effectiveDate":"2025-10-01","expirationDate":"2026-10-01"}'::jsonb,
   '[{"path":"risk.auto_vehicle.usage","from":"pleasure","to":"commute"}]'::jsonb,
   '{"premium":{"total":{"amount":872.25,"currency":"USD"}}}'::jsonb,
   'cccc0000-0000-4000-8000-00000000e001',
   '{"decision":"Approve","decidedBy":"44444444-4444-4444-8444-444444444444","decidedAt":"2025-09-22T13:11:03Z","referralReasons":["PriorLosses"]}'::jsonb,
   NULL, ARRAY['form-pa-iso-pp0001','form-pa-um'], ARRAY['doc-pa-policy'], '2025-09-20T14:22:05Z'::timestamptz,
   '33333333-3333-4333-8333-333333333333',
   '{"sourceQuoteId":"Q-PA-0001"}'::jsonb)
ON CONFLICT (transaction_id) DO NOTHING;

INSERT INTO policy_versions
  (version_id, tenant_id, policy_id, transaction_id, effective_date, transaction_type, premium_summary, currency_code, uw_decision, uw_override, payload)
VALUES
  ('dddd0000-0000-4000-8000-00000000f001', 'sample-carrier', 'aaaa0000-0000-4000-8000-00000000a001',
   'bbbb0000-0000-4000-8000-00000000d001', DATE '2025-10-01', 'NB',
   '{"total":{"amount":872.25,"currency":"USD"}}'::jsonb, 'USD', 'Approve', false,
   '{"policyNumber":"PA-2025-0001","product":"personal-auto","term":{"effectiveDate":"2025-10-01","expirationDate":"2026-10-01"}}'::jsonb)
ON CONFLICT (version_id) DO NOTHING;

-- Risk units for PA policy
INSERT INTO risk_units (risk_unit_id, tenant_id, policy_id, transaction_id, kind, attributes, effective_date)
VALUES
  ('eeee0000-0000-4000-8000-00000000a101', 'sample-carrier', 'aaaa0000-0000-4000-8000-00000000a001',
   'bbbb0000-0000-4000-8000-00000000d001', 'autoVehicle',
   '{"vin":"1HGCM82633A123456","year":2022,"make":"Honda","model":"Civic","usage":"commute","annualMileage":15000,"garagingPostal":"19341"}'::jsonb,
   DATE '2025-10-01'),
  ('eeee0000-0000-4000-8000-00000000a102', 'sample-carrier', 'aaaa0000-0000-4000-8000-00000000a001',
   'bbbb0000-0000-4000-8000-00000000d001', 'autoDriver',
   '{"partyId":"11111111-1111-4111-8111-111111111111","licenseState":"PA","yearsLicensed":15,"points":0}'::jsonb,
   DATE '2025-10-01'),
  ('eeee0000-0000-4000-8000-00000000a103', 'sample-carrier', 'aaaa0000-0000-4000-8000-00000000a001',
   'bbbb0000-0000-4000-8000-00000000d001', 'autoDriver',
   '{"partyId":"22222222-2222-4222-8222-222222222222","licenseState":"PA","yearsLicensed":2,"points":2,"goodStudent":true}'::jsonb,
   DATE '2025-10-01')
ON CONFLICT (risk_unit_id) DO NOTHING;

INSERT INTO risk_unit_vehicle (risk_unit_id, tenant_id, vin, year, make, model, symbol, usage, annual_mileage, garaging_postal, ownership, metadata)
VALUES
  ('eeee0000-0000-4000-8000-00000000a101', 'sample-carrier', '1HGCM82633A123456', 2022, 'Honda', 'Civic EX', 'CIVIC-2022', 'commute', 15000, '19341', 'Owned', '{"safetyFeatures":["ABS","Airbags"]}'::jsonb)
ON CONFLICT (risk_unit_id) DO NOTHING;

INSERT INTO risk_unit_driver (risk_unit_id, tenant_id, party_id, license_number, license_state, years_licensed, points, metadata)
VALUES
  ('eeee0000-0000-4000-8000-00000000a102', 'sample-carrier', '11111111-1111-4111-8111-111111111111', 'PA12345678', 'PA', 15, 0, NULL),
  ('eeee0000-0000-4000-8000-00000000a103', 'sample-carrier', '22222222-2222-4222-8222-222222222222', 'PA87654321', 'PA', 2, 2, '{"goodStudent":true}'::jsonb)
ON CONFLICT (risk_unit_id) DO NOTHING;

-- Coverages & selections
INSERT INTO coverages
  (coverage_id, tenant_id, policy_id, transaction_id, risk_ref, applies_to, definition_code, limits, deductibles, options, effective_date)
VALUES
  ('99990000-0000-4000-8000-00000000c201', 'sample-carrier', 'aaaa0000-0000-4000-8000-00000000a001',
   'bbbb0000-0000-4000-8000-00000000d001', 'aaaa0000-0000-4000-8000-00000000a001', 'policy', 'PA.LIAB.BI',
   '{"perPerson":100000,"perAccident":300000}'::jsonb, '{}'::jsonb, '{"stacked":false}'::jsonb, DATE '2025-10-01'),
  ('99990000-0000-4000-8000-00000000c202', 'sample-carrier', 'aaaa0000-0000-4000-8000-00000000a001',
   'bbbb0000-0000-4000-8000-00000000d001', 'aaaa0000-0000-4000-8000-00000000a001', 'policy', 'PA.LIAB.PD',
   '{"perAccident":100000}'::jsonb, '{}'::jsonb, NULL, DATE '2025-10-01'),
  ('99990000-0000-4000-8000-00000000c203', 'sample-carrier', 'aaaa0000-0000-4000-8000-00000000a001',
   'bbbb0000-0000-4000-8000-00000000d001', 'eeee0000-0000-4000-8000-00000000a101', 'vehicle', 'PA.PHY.COMP',
   '{}'::jsonb, '{"amount":500}'::jsonb, '{"glassWaiver":true}'::jsonb, DATE '2025-10-01')
ON CONFLICT (coverage_id) DO NOTHING;

INSERT INTO coverage_selections (selection_id, tenant_id, policy_id, version_id, coverage_code, selected, limit_value, deductible, percent)
VALUES
  ('sel-pa-bi', 'sample-carrier', 'aaaa0000-0000-4000-8000-00000000a001', 'dddd0000-0000-4000-8000-00000000f001', 'PA.LIAB.BI', true, 300000, NULL, NULL),
  ('sel-pa-pd', 'sample-carrier', 'aaaa0000-0000-4000-8000-00000000a001', 'dddd0000-0000-4000-8000-00000000f001', 'PA.LIAB.PD', true, 100000, NULL, NULL),
  ('sel-pa-comp', 'sample-carrier', 'aaaa0000-0000-4000-8000-00000000a001', 'dddd0000-0000-4000-8000-00000000f001', 'PA.PHY.COMP', true, NULL, 500, NULL)
ON CONFLICT (selection_id) DO NOTHING;

-- Rating results
INSERT INTO ratings
  (rating_id, tenant_id, policy_id, transaction_id, inputs, components, discounts, surcharges, taxes, total_premium, currency_code, calc_trace)
VALUES
  ('cccc0000-0000-4000-8000-00000000e001', 'sample-carrier', 'aaaa0000-0000-4000-8000-00000000a001',
   'bbbb0000-0000-4000-8000-00000000d001',
   '{"ratingFactors":{"driverAgeBand":"25-64","vehicleSymbol":"CIVIC-2022","territory":"PA-19341","multiPolicy":true},"tablesVersion":"PA-BASE-2025.09"}'::jsonb,
   '[{"code":"BASE","amount":{"value":780.0,"currency":"USD"}},{"code":"FEE","amount":{"value":25.0,"currency":"USD"}}]'::jsonb,
   '[{"code":"MULTI_POLICY","amount":{"value":-35.0,"currency":"USD"}}]'::jsonb,
   '[{"code":"YOUNG_DRIVER","amount":{"value":15.0,"currency":"USD"}}]'::jsonb,
   '[{"code":"PREMIUM_TAX","amount":{"value":24.75,"currency":"USD"},"rate":0.03}]'::jsonb,
   872.25, 'USD',
   '[{"step":1,"expr":"BASE table lookup","value":780.0},{"step":2,"expr":"Discounts","value":-35.0},{"step":3,"expr":"Surcharges","value":15.0},{"step":4,"expr":"Fees","value":25.0},{"step":5,"expr":"Taxes","value":24.75}]'::jsonb)
ON CONFLICT (rating_id) DO NOTHING;

-- Forms & documents
INSERT INTO policy_forms (policy_form_id, tenant_id, policy_id, transaction_id, form_id, sequence_no, metadata)
VALUES
  ('formlink-pa-1', 'sample-carrier', 'aaaa0000-0000-4000-8000-00000000a001', 'bbbb0000-0000-4000-8000-00000000d001', 'form-pa-iso-pp0001', 1, NULL),
  ('formlink-pa-2', 'sample-carrier', 'aaaa0000-0000-4000-8000-00000000a001', 'bbbb0000-0000-4000-8000-00000000d001', 'form-pa-um', 2, NULL)
ON CONFLICT (policy_form_id) DO NOTHING;

INSERT INTO documents (document_id, tenant_id, policy_id, transaction_id, type, uri, hash, created_at)
VALUES
  ('doc-pa-policy', 'sample-carrier', 'aaaa0000-0000-4000-8000-00000000a001', 'bbbb0000-0000-4000-8000-00000000d001',
   'Policy', 's3://artifacts/policies/PA-2025-0001/policy.pdf', 'sha256:abc123', '2025-09-22T10:20:00Z'::timestamptz)
ON CONFLICT (document_id) DO NOTHING;

INSERT INTO notes (note_id, tenant_id, transaction_id, note_type, note_text, visibility, added_by, metadata)
VALUES
  ('note-pa-uw', 'sample-carrier', 'bbbb0000-0000-4000-8000-00000000d001', 'UW', 'Prior losses reviewed, acceptable risk.', ARRAY['Underwriter','Agent'], '44444444-4444-4444-8444-444444444444', NULL)
ON CONFLICT (note_id) DO NOTHING;

INSERT INTO uw_decisions (decision_id, tenant_id, transaction_id, rules_triggered, decision, conditions, decided_by, metadata)
VALUES
  ('uwdec-pa-1', 'sample-carrier', 'bbbb0000-0000-4000-8000-00000000d001', ARRAY['UW_MAX_VALUE'], 'Approve', ARRAY['Bind within 30 days'], '44444444-4444-4444-8444-444444444444', NULL)
ON CONFLICT (decision_id) DO NOTHING;

INSERT INTO ledger_events (event_id, tenant_id, entity_type, entity_id, event, from_state, to_state, payload, occurred_at, actor)
VALUES
  ('ledg-pa-issue', 'sample-carrier', 'Policy', 'aaaa0000-0000-4000-8000-00000000a001', 'STATUS_CHANGE', 'Bound', 'Issued',
   '{"transactionId":"bbbb0000-0000-4000-8000-00000000d001","policyNumber":"PA-2025-0001"}'::jsonb,
   '2025-09-22T10:15:42Z'::timestamptz, '44444444-4444-4444-8444-444444444444')
ON CONFLICT (event_id) DO NOTHING;

-- Policy: Homeowners -------------------------------------------------------
INSERT INTO policies
  (policy_id, tenant_id, policy_number, status, product_code, product_version,
   jurisdiction_code, term_effective_date, term_expiration_date, term_type,
   currency_code, insured_party_id, premium_summary, lifecycle, metadata)
VALUES
  ('bbbb0000-0000-4000-8000-00000000a002', 'sample-carrier', NULL, 'Quote',
   'homeowners', '1.2.3', 'CA-US', DATE '2025-11-01', DATE '2026-11-01', 'Annual',
   'USD', '11111111-1111-4111-8111-111111111111',
   '{"total":{"amount":1418.80,"currency":"USD"},"fees":{"amount":35,"currency":"USD"},"taxes":{"amount":43.8,"currency":"USD"}}'::jsonb,
   '{"createdAt":"2025-09-24T16:02:11Z","createdBy":"33333333-3333-4333-8333-333333333333"}'::jsonb,
   '{"projectionVersion":1}'::jsonb)
ON CONFLICT (policy_id) DO NOTHING;

INSERT INTO policy_parties (policy_party_id, tenant_id, policy_id, party_id, role_code, relationship, is_primary)
VALUES
  ('bbbb0000-0000-4000-8000-00000000b201', 'sample-carrier', 'bbbb0000-0000-4000-8000-00000000a002', '11111111-1111-4111-8111-111111111111', 'NamedInsured', 'Primary', true),
  ('bbbb0000-0000-4000-8000-00000000b202', 'sample-carrier', 'bbbb0000-0000-4000-8000-00000000a002', '55555555-5555-4555-8555-555555555555', 'Mortgagee', NULL, false),
  ('bbbb0000-0000-4000-8000-00000000b203', 'sample-carrier', 'bbbb0000-0000-4000-8000-00000000a002', '33333333-3333-4333-8333-333333333333', 'Producer', NULL, false)
ON CONFLICT (policy_party_id) DO NOTHING;

INSERT INTO policy_transactions
  (transaction_id, tenant_id, policy_id, type, status, jurisdiction, term, requested_changes, snapshot, rating_id, uw, forms, documents, created_at, created_by)
VALUES
  ('cccc0000-0000-4000-8000-00000000d002', 'sample-carrier', 'bbbb0000-0000-4000-8000-00000000a002',
   'NB', 'Quoted',
   '{"code":"CA-US","ratingDate":"2025-09-24"}'::jsonb,
   '{"effectiveDate":"2025-11-01","expirationDate":"2026-11-01"}'::jsonb,
   '[{"path":"coverages[?definitionCode==\"HO.DWELL.COVA\"].limits.amount","to":450000}]'::jsonb,
   '{"risk":{"dwelling":{"yearBuilt":2018,"construction":"Frame"}},"premium":{"total":{"amount":1418.8,"currency":"USD"}}}'::jsonb,
   'cccc0000-0000-4000-8000-00000000e002',
   '{"decision":"RequestInfo","referralReasons":["HO-ROOF-AGE"],"decidedBy":"44444444-4444-4444-8444-444444444444"}'::jsonb,
   ARRAY['form-ho-iso-ho3'], ARRAY['doc-ho-quote'], '2025-09-24T16:02:11Z'::timestamptz, '33333333-3333-4333-8333-333333333333')
ON CONFLICT (transaction_id) DO NOTHING;

INSERT INTO risk_units (risk_unit_id, tenant_id, policy_id, transaction_id, kind, attributes, effective_date)
VALUES
  ('ffff0000-0000-4000-8000-00000000a201', 'sample-carrier', 'bbbb0000-0000-4000-8000-00000000a002',
   'cccc0000-0000-4000-8000-00000000d002', 'dwelling',
   '{"address":{"line1":"22 Hill Rd","city":"Calabasas","state":"CA","postalCode":"91302"},"yearBuilt":2018,"construction":"Frame","roof":"Architectural Shingle","roofAgeYears":7,"sqft":2600,"numStories":2,"occupancy":"OwnerOccupied","protectionClass":3,"distanceToHydrant":250,"alarms":{"fire":true,"burglar":true}}'::jsonb,
   DATE '2025-11-01')
ON CONFLICT (risk_unit_id) DO NOTHING;

INSERT INTO risk_unit_dwelling (risk_unit_id, tenant_id, address, construction, roof, roof_age_years, sqft, num_stories, occupancy, protection_class, distance_to_hydrant, heating, alarms)
VALUES
  ('ffff0000-0000-4000-8000-00000000a201', 'sample-carrier',
   '{"line1":"22 Hill Rd","city":"Calabasas","state":"CA","postalCode":"91302"}'::jsonb,
   'Frame', 'Architectural Shingle', 7, 2600, 2, 'OwnerOccupied', 3, 250, 'Gas',
   '{"fire":true,"burglar":true}'::jsonb)
ON CONFLICT (risk_unit_id) DO NOTHING;

INSERT INTO coverages
  (coverage_id, tenant_id, policy_id, transaction_id, risk_ref, applies_to, definition_code, limits, deductibles, options, effective_date)
VALUES
  ('88880000-0000-4000-8000-00000000d301', 'sample-carrier', 'bbbb0000-0000-4000-8000-00000000a002',
   'cccc0000-0000-4000-8000-00000000d002', 'ffff0000-0000-4000-8000-00000000a201', 'risk', 'HO.DWELL.COVA',
   '{"amount":450000}'::jsonb, '{"amount":1000}'::jsonb, NULL, DATE '2025-11-01'),
  ('88880000-0000-4000-8000-00000000d302', 'sample-carrier', 'bbbb0000-0000-4000-8000-00000000a002',
   'cccc0000-0000-4000-8000-00000000d002', 'bbbb0000-0000-4000-8000-00000000a002', 'policy', 'HO.LIAB',
   '{"perOccurrence":300000}'::jsonb, '{}'::jsonb, NULL, DATE '2025-11-01')
ON CONFLICT (coverage_id) DO NOTHING;

INSERT INTO ratings
  (rating_id, tenant_id, policy_id, transaction_id, inputs, components, discounts, surcharges, taxes, total_premium, currency_code, calc_trace)
VALUES
  ('cccc0000-0000-4000-8000-00000000e002', 'sample-carrier', 'bbbb0000-0000-4000-8000-00000000a002',
   'cccc0000-0000-4000-8000-00000000d002',
   '{"ratingFactors":{"construction":"Frame","protectionClass":3,"roofAgeYears":7,"territory":"CA-91302","replacementCost":450000},"tablesVersion":"HO-BASE-2025.08"}'::jsonb,
   '[{"code":"BASE","amount":{"value":1320.0,"currency":"USD"}},{"code":"ENDORSE","amount":{"value":80.0,"currency":"USD"}}]'::jsonb,
   '[{"code":"ALARM","amount":{"value":-60.0,"currency":"USD"}}]'::jsonb,
   '[]'::jsonb,
   '[{"code":"FIRE_MARSHAL","amount":{"value":12.8,"currency":"USD"},"rate":0.009}]'::jsonb,
   1418.8, 'USD',
   '[{"step":1,"expr":"Base premium"} ,{"step":2,"expr":"Alarm credit"}, {"step":3,"expr":"Water backup endorsement"}, {"step":4,"expr":"Jurisdictional taxes"}]'::jsonb)
ON CONFLICT (rating_id) DO NOTHING;

INSERT INTO documents (document_id, tenant_id, policy_id, transaction_id, type, uri, hash, created_at)
VALUES
  ('doc-ho-quote', 'sample-carrier', 'bbbb0000-0000-4000-8000-00000000a002', 'cccc0000-0000-4000-8000-00000000d002',
   'Quote', 's3://artifacts/policies/HO-2025-0100/quote.pdf', 'sha256:def456', '2025-09-24T16:05:00Z'::timestamptz)
ON CONFLICT (document_id) DO NOTHING;

INSERT INTO ledger_events (event_id, tenant_id, entity_type, entity_id, event, from_state, to_state, payload, occurred_at, actor)
VALUES
  ('ledg-ho-quote', 'sample-carrier', 'Transaction', 'cccc0000-0000-4000-8000-00000000d002', 'STATUS_CHANGE', 'InProgress', 'Quoted',
   '{"policyId":"bbbb0000-0000-4000-8000-00000000a002","transactionId":"cccc0000-0000-4000-8000-00000000d002"}'::jsonb,
   '2025-09-24T16:44:50Z'::timestamptz, '44444444-4444-4444-8444-444444444444')
ON CONFLICT (event_id) DO NOTHING;

COMMIT;
