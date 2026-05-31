# Policy Administration System (PAS) - Relational MVP

Blueprint for delivering the PAS MVP on a traditional relational database (Postgres 15+). Mirrors the schema created by `server/migrations/001_init.sql` and supports Personal Auto (PA) plus Homeowners (HO) with clear paths for future lines of business.

## 0. Design Tenets
- **Product-agnostic kernel**: Policies, transactions, risk units, coverages, rating, forms, parties, and RBAC tables form the shared foundation. Product-specific details live in facet/extension tables.
- **Transaction-first lifecycle**: `policy_transactions` store every state change (NB, endorsements, cancels, reinstates, rewrites, renewals); `policies` holds the projection for fast reads.
- **Globalization ready**: Policies and transactions carry jurisdiction, currency, and locale metadata to support multinational rollouts.
- **Metadata-driven**: `field_meta`, `coverage_definitions`, `forms_catalog`, and tenant override tables power dynamic UI, validation, and RBAC enforcement.
- **Audit & replay**: `ledger_events` provides an immutable history, complemented by audit timestamps and optional history tables for compliance.
- **Event-source friendly**: Policy projections can be rebuilt from `policy_transactions` and `ledger_events` for analytics or recovery.

## 1. Logical ERD (simplified)
```
party 1-* policy_role_assignment *-1 policy
policy 1-* policy_transaction *-1 rating
policy 1-* risk_unit 1-* coverage
policy 1-* policy_form
policy 1-* policy_document
policy_transaction 1-* transaction_note
policy_transaction 1-* transaction_uw_decision
product 1-* coverage_definition
jurisdiction 1-* regulatory_rule
producer_org 1-* party
```
- `risk_unit.kind` discriminates PA vehicles/drivers vs HO dwellings/structures, etc.
- Coverages reference canonical definitions for rating, forms, and UI behavior.

## 2. Core Tables & Columns

### policies
- `policy_id uuid primary key default uuid_generate_v4()`
- `tenant_id text` (RLS scope), `policy_number varchar(40) unique`, `status policy_status_enum`, `product_code text`, `product_version text`, `jurisdiction_code text`, `term_effective_date date`, `term_expiration_date date`, `term_type text`, `currency_code char(3)`, `insured_party_id uuid references parties`, `premium_summary jsonb`, `risk_summary jsonb`, `lifecycle jsonb`, `external_ids jsonb`, `metadata jsonb`, `voided_at timestamptz`.
- Indexes: unique on `policy_number`; `(tenant_id, status)`, `(tenant_id, product_code)`, `(tenant_id, jurisdiction_code)`, `(tenant_id, insured_party_id)`, `(tenant_id, term_effective_date, term_expiration_date)`.

### policy_transactions
- PK `transaction_id uuid`.
- Columns: `tenant_id`, `policy_id`, `type txn_type_enum`, `status txn_status_enum`, `jurisdiction jsonb`, `term jsonb`, `requested_changes jsonb`, `snapshot jsonb`, `rating_id uuid`, `uw jsonb`, `notes jsonb`, `forms jsonb`, `documents jsonb`, `created_by uuid`, `metadata jsonb`, `voided_at`.
- Indexes: `(tenant_id, policy_id, created_at DESC)`, `(tenant_id, status)`, `(tenant_id, type)`.

### policy_versions
- Stores payloads for bind/issue/endorse/cancel/etc events.
- Columns: `version_id uuid`, `tenant_id`, `policy_id`, `effective_date date`, `transaction_type text`, `premium_total numeric(14,2)`, `premium_fees numeric(14,2)`, `premium_taxes numeric(14,2)`, `currency char(3)`, `uw_decision text`, `uw_override boolean`, `override_reason text`, `calc_trace jsonb`, `payload jsonb`, `processed_at timestamptz`.

### risk_units
- PK `risk_unit_id uuid`.
- Columns: `tenant_id`, `policy_id`, `transaction_id`, `kind text`, `attributes jsonb`, `effective_date date`, `expiration_date date`.
- Facet tables:
  - `auto_vehicles`: year, make, model, vin, symbol, garaging_zip, usage, annual_miles, driver_age.
  - `dwellings`: address, construction, protection_class, year_built, roof_age_years, square_feet, etc.
  - Additional tables (`risk_unit_other_structure`, `risk_unit_liability`, etc.) follow the same pattern.

### coverages & coverage_selections
- `coverages`: PK `coverage_id uuid`; columns: `tenant_id`, `policy_id`, `transaction_id`, `risk_ref uuid`, `applies_to text`, `definition_code text`, `limits jsonb`, `deductibles jsonb`, `options jsonb`, `effective_date`, `expiration_date`.
- `coverage_selections`: captures UI selections per policy version (coverage_code, selected flag, limit_value, deductible, percent).
- Indexes: `(tenant_id, policy_id, definition_code)`, `(tenant_id, policy_id, risk_ref)`.

### ratings
- PK `rating_id uuid`.
- Columns: `tenant_id`, `policy_id`, `transaction_id`, `inputs jsonb`, `components jsonb`, `discounts jsonb`, `surcharges jsonb`, `taxes jsonb`, `total_premium numeric(14,2)`, `currency char(3)`, `calc_trace jsonb`.
- Index: `(tenant_id, policy_id, transaction_id)`.

### forms & documents
- `forms_catalog`: code, edition, applicability rules, render metadata (template id, data bindings).
- `policy_forms`: links policy/version to forms with `sequence_no`.
- `documents`: `document_id uuid`, `tenant_id`, `policy_id`, `transaction_id`, `type text`, `uri text`, `hash text`, `created_at`.

### parties & RBAC
- `parties` plus `party_contacts`, `party_licenses`, `party_roles` manage people/organizations.
- `policy_parties` enumerates party involvement on a policy.
- `policy_role_assignments`: `role_code`, `permissions text[]`, `scope jsonb`, `granted_at`, `granted_by` - used in conjunction with `field_meta` to enforce field-level RBAC.

### field_meta
- `meta_id uuid`, `tenant_id`, `path`, `type`, `enum_values text[]`, `required boolean`, `visible_to text[]`, `editable_by text[]`, `validation jsonb`, `i18n jsonb`, `ui jsonb`, `active boolean`.
- Unique partial index on `(tenant_id, path)` where `active`.

### ledger_events
- Columns: `event_id uuid`, `tenant_id`, `entity_type`, `entity_id uuid`, `event text`, `from_state text`, `to_state text`, `payload jsonb`, `occurred_at timestamptz default now()`, `actor uuid`, optional hash chaining via `hash`/`prev_hash`.
- Index: `(tenant_id, entity_type, entity_id, occurred_at DESC)`.

### jurisdictions & regulatory_rules
- `jurisdictions`: `code`, `country`, `region`, `currency`, `tax jsonb`, `compliance jsonb`, `forms_pack text[]`.
- `regulatory_rules`: references jurisdiction and stores regulatory metadata (notice days, restrictions, etc.).
- RLS allows shared (`tenant_id = 'global'`) and tenant-specific overrides.

## 3. Enumerations & State Machines
- **Policy status**: `Quote → Draft → Bound → Issued → (Cancelled | Expired)`
- **Transaction type**: `NB`, `ENDORSE`, `CANCEL`, `REINSTATE`, `REWRITE`, `RENEW`
- **Transaction status**: `InProgress → Quoted → (Approved|Declined) → Bound → Issued → (Voided)`
- **Roles**: `Customer`, `Agent/Producer`, `Underwriter`, `Admin`, `Billing`
- Service layer enforces transitions and writes corresponding `ledger_events`.

## 4. Transaction Swimlanes
- **New Business**: quote captured → risk & coverage completion → insert NB `policy_transaction` + `ratings` → UW decision → on bind, insert projection (`policies`, `policy_versions`) → on issue, assign `policy_number`, attach forms/documents, write ledger.
- **Endorsement**: create endorsement transaction referencing prior version → apply change set (`requested_changes`) → re-rate → insert coverage updates → when issued, update projection + ledger.
- **Cancellation**: record reason/effective date, compute unearned premium, create cancellation documents, update policy status and ledger.
- **Reinstatement**: Validation of cure, adjust premium via rating, insert reinstatement policy version, log event.
- **Rewrite**: Stored procedure clones policy, risk units, coverages, metadata to a new policy row; link via `external_ids.rewrite_of`.
- **Renewal**: Pre-renewal seeds new transaction & version; when issued, extends term and updates projection.

## 5. Field Metadata & RBAC Example
```sql
INSERT INTO field_meta
  (tenant_id, path, type, enum_values, required, visible_to, editable_by, validation, i18n, ui)
VALUES
  ('global',
   'risk.auto_vehicle.usage',
   'enum',
   ARRAY['pleasure','commute','business'],
   true,
   ARRAY['agent','underwriter'],
   ARRAY['agent','underwriter'],
   '{"when":"product_code = ''personal-auto''","message":"Usage is required"}'::jsonb,
   '{"labelKey":"vehicle.use","helpKey":"vehicle.use.help"}'::jsonb,
   '{"widget":"select","order":120,"group":"Vehicle"}'::jsonb);
```
- Controllers/services join `policy_role_assignments` + `field_meta` to gate read/write operations.

## 6. Index & Performance Guidance
- Maintain b-tree indexes on query-critical columns (policy_number, status, product_code, jurisdiction_code).
- Consider partial indexes for active policies (`voided_at IS NULL`), active metadata (`active IS TRUE`).
- GIN indexes on JSONB columns heavily filtered by UI (e.g., `field_meta.visible_to`, `coverage_definitions.ui`).
- Plan for table growth: partition `ledger_events` by month/quarter, optionally `policy_transactions` by created_at.

## 7. Audit & Replay
- Audit columns (`created_at`, `updated_at`, `voided_at`) exist on core tables.
- Optionally add history tables (via trigger) capturing `old`/`new` row versions.
- `ledger_events` drives projections and facilitates replay into data warehouse views (e.g., `policy_projection_view`).

## 8. Internationalization
- `jurisdictions` supply currency, tax rates, notice days, and default form packs per locale.
- `field_meta.i18n` keys align with translation catalogs served to UI clients.
- Address/phone validation logic stored in `party_contacts.metadata` keyed by locale.

## 9. Developer Checklist
1. Apply `server/migrations/001_init.sql` to initialize schema, enums, RLS, and indexes.
2. Seed reference catalogs: `jurisdictions`, `regulatory_rules`, `coverage_definitions` (PA & HO), `forms_catalog`, `field_meta`.
3. Implement service-layer transaction state machine ensuring valid status transitions.
4. Persist rating outputs (`ratings`, `policy_versions`) and append `ledger_events` for all meaningful transitions.
5. Hydrate policy projections on bind/issue using transactions + risk/coverage persistence helpers.
6. Enforce RBAC using `policy_role_assignments` combined with `field_meta`.
7. Establish maintenance routines (VACUUM, ANALYZE) and retention policies for large tables, especially `ledger_events`.

## 10. Sample Data
- See `contracts/sample-data/pas_mvp_seed.sql` for representative seed data covering tenants, parties, policies, transactions, risk units, coverages, ratings, forms, and ledger events across PA and HO scenarios.
- See `contracts/sample-data/ho_policy_seed.sql` plus `docs/HO_JSON_TO_RELATIONAL.md` for the HO JSON → relational walkthrough with ledger, notes, and document linkage.

---

This document aligns the MVP architecture with the traditional relational/postgres implementation already present in the codebase, satisfying the requirement to avoid NoSQL while retaining extensibility for future products and tenants.
