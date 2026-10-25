# Design - WP-0010: Businessowners Policy

Status: proposed for Gate B. Gate A approved by Kishor Kumar Jakkula ("Approved").
No application implementation or live seed changes authorized at this stage.

## Options and decision

1. Dedicated BOP service/rater/UI: permits independent complexity, but duplicates
   lifecycle, authorization, validation and forms behavior. Not selected.
2. Configuration-first core product pack with narrow shared-framework extensions:
   selected. Use `businessowners`, `ratingAdapter: rate-table`, catalog forms,
   an explicit `businessownersLocation` risk kind, existing quote/lifecycle APIs.
   Extend contracts and presentation only where the current framework cannot
   represent the approved package. Do not masquerade as a dwelling/cyber risk.

## Product and coverage representation

Add products/businessowners/{coverage.yaml,rates.yaml,README.md,documents/}.
Version 1.0.0; availability US/OH; 12-month term; exactly one risk/premises.
Use existing metadata and validation configuration for required fields,
relationships and appetite; backend validation is mandatory even if UI defaults
select the package. Missing state/company/authorization must fail closed for BOP.

Proposed demo terms (NOT filed or universal insurance requirements):

| Coverage | Proposed configuration |
| --- | --- |
| BOP_BUILDING | Optional for tenant; required when insuring an owned building. Replacement-cost demo limit 500,000; selectable value 100,000-5,000,000. |
| BOP_BPP | Required; replacement-cost demo limit 100,000; selectable value 10,000-1,000,000. |
| BOP_BI_EE | Required combined business income/extra expense; explicit dollar limit 100,000, up to 12 months restoration, 72-hour income waiting period. Extra expense shares the limit, no duplicate premium. |
| BOP_LIAB | Required occurrence-based business liability; 500,000/1,000,000/2,000,000 occurrence choices; default 1,000,000. General and products-completed operations aggregates each 2x occurrence in this demo. |
| BOP_MED | Included medical expenses, 5,000 per person; no separate charge. |
| BOP_EQUIP | Optional equipment breakdown, 25,000/50,000/100,000; deductible 1,000. |
| BOP_WATER | Optional water backup, 5,000/10,000/25,000; deductible 1,000. |

Building/BPP deductibles: 1,000 default, 2,500 or 5,000 alternatives.
Personal/advertising injury included at occurrence limit; damage to premises
rented to the insured 100,000 as an included sublimit, not another charged row.
All included benefits must appear in review/documents without inflating totals.
Do not claim unrestricted actual-loss-sustained, flood, earthquake, professional
liability, auto, workers compensation or cyber coverage.

Current coverage selection shapes principally represent limit/deductible. Add
typed optional package terms for occurrence/aggregate/included sublimits and
income basis/wait/restoration where needed. Derive authoritative fixed terms
from versioned product configuration, validate client selections, persist into
policy snapshots and document contexts. Never trust browser-only metadata.
Keep existing coverage behavior unchanged. Product-specific terms must be
visible to intake/review or explicitly read-only derived; do not silently drop
them in approval or servicing.

## Risk, rules and dependencies

Risk fields: business name; class (office/retail/service, demo classifications not
licensed ISO codes); revenue, relevant payroll, employees, business age, prior
loss count/amount; owner/tenant; structured single US premises address; building
year, area, construction, protection class, roof age, alarms/sprinklers;
vacancy and hazardous-operation facts. Missing facts remain missing.
Main insured email/mobile stay outside postal addresses, using current controls.

Proposed demo appetite: eligibility classes above, annual sales <=5,000,000,
employees <=50 and one premises. Unknown class/state, invalid values, more than
one premises, negative limits, missing package parts and building without
insurable interest block the appropriate operation. Prior losses >0, roof age
>20 years or protection class 9/10 refer. Vacancy >30 days or hazardous
manufacturing operations decline. These are editable demo rules, not industry
standards; preserve existing referral proposal/authority and audit semantics.

Use existing tenant eligibility, underwriting_companies, agency/producer and
onboarding/appointment models, plus validation/UW/form configurations. Explicitly
trace existing backend enforcement: quote.service currently tolerates a missing
eligibility table, and appointment storage alone does not prove a bind gate.
Close only gaps required for BOP; do not weaken or silently change other products.

Opt-in demo setup for sample-carrier: "Lattice Demo Commercial Insurance Company",
"Lattice Demo Business Agency", synthetic producer identity/relationships,
Ohio BOP appointment/eligibility, two customers (tenant office and owner retail),
two ready-to-rate quotes and one issued example created through domain flows,
not fabricated premium/audit SQL. Add separate referral/decline and dependency
negative fixtures. No new public login/password required: explicitly associate
an authorized existing demo agent or request a supplied test identity. Use
supported business services and audited tenant-scoped transactions. Setup must
be retryable, concurrency-safe, identifiable by stable demo keys and refuse to
overwrite existing mismatched records. No seeding during normal production boot.

## Components, data and APIs

- Shared types/runtime schemas, JSON contracts, product registry/risk mapping;
  remove no existing product support. JSON quote schema currently contains a
  fixed product/risk enum; update consistently rather than only adding YAML.
- Product loading/field metadata/default coverages; generic risk and coverage
  UI, address handling, underwriting/validation catalog, intake targets and
  approval mapping; demo upload generator/catalog coverage test.
- Quote/rate/bind/issue/lifecycle, product snapshots, projections and form context.
- Existing admin/referral/company/agency screens, seed tooling, docs and tests.
- No new service/dependency/cloud resource; rating stays synchronous/in-process.
- Prefer existing JSON payload/snapshot storage and reference tables: no schema
  migration assumed. If investigation requires columns/tables, document and
  review a forward-only migration number before implementation; never rewrite
  migrations 067-070 or the unrelated WP-0007 work.

Use existing /api/v1/products, config/reference, submissions, quotes, policies,
administration and transaction endpoints; preserve response envelopes.
Example quote fragment:
`{"productCode":"businessowners","state":"OH","termMonths":12,
"risks":[{"type":"businessownersLocation","businessClass":"office",
"occupancy":"tenant","annualRevenue":750000}],
"coverages":[{"code":"BOP_BPP","selected":true,"limit":100000,"deductible":1000},
{"code":"BOP_BI_EE","selected":true,"limit":100000},
{"code":"BOP_LIAB","selected":true,"limit":1000000},
{"code":"BOP_MED","selected":true,"limit":5000}]}`
This fragment omits required insured/location/qualification details intentionally;
it is not a valid complete request. Add a complete contract fixture.
Reuse PRODUCT_RULES_NOT_MET, VALIDATION_FAILED and relevant existing eligibility/
authority errors with field-level details; document any new BOP error codes.
Do not invent an endpoint just to load the demo.

## Pricing and performance

Use explicit per-coverage rate-table entries; no generic fallback rate for an
unknown coverage. Synthetic example baseline with all factors=1:
building 500,000 x2/1,000=1,000; BPP 100,000 x3/1,000=300;
income 100,000 x1/1,000=100; liability 1,000,000=400;
included medical/subterms=0. Owner total 1,800, tenant total 800.
Minimum premium 500; demo policy fee 0, demo taxes 0 (NOT a tax exemption claim).
Proposed equipment premiums 50/90/160, water 25/45/90 by offered limit.
Class, construction, protection, loss-history and deductible factors live in
rates configuration with explicit required-factor failure and trace coverage.
Exact alternative factors and golden totals must be documented before tests
are implemented. Avoid indiscriminately multiplying liability by property-only
risk factors: use existing coverage applyFactors controls; if separate factor
groups are needed, a backward-compatible shared config extension is preferable.
No remote calls in rating; cache using existing version-aware configuration.

## Security, rollout and rollback

Retain current permissions/RLS and authoritative backend checks at each action.
Customer projections expose no internal UW/rating notes. No secrets, real
customer data, real NAIC company/NPN/license numbers or external address/AI calls.
Intake only proposes values and requires human approval; no automatic training.
Demo records/forms carry synthetic/non-contract labels. Version-pin terms and
historical documents. Roll out only after Gate C; no automatic Docker rebuild
or live database changes at Gate B. Disable future BOP eligibility/configuration
for rollback, retain existing policies/audit and their pinned definitions.
Seed cleanup must target only explicit demo keys and never delete issued/audited
history as a convenience rollback.

## Requirement mapping

| Requirement | Design element |
| --- | --- |
| REQ-1 | Core pack, schemas, registry and existing screens |
| REQ-2 | Package, fixed terms, conditional building and immutable snapshots |
| REQ-3 | Coverage options, included benefits and server-validated income terms |
| REQ-4 | BOP risk metadata and structured single-premises address |
| REQ-5 | Explicit rate-table entries, factors and golden component totals |
| REQ-6 | Shared validation, configured appetite and existing referral gates |
| REQ-7 | Tenant eligibility, company, agency and authorization setup/enforcement |
| REQ-8 | Opt-in idempotent seed plus intake/golden synthetic fixtures |
| REQ-9 | Transaction-level original demo templates and pinned editions |
| REQ-10 | Test matrix, isolated regression, docs and independent review |

## ADR

Proposed ADR 0004: configuration-first BOP with explicit package terms, one
premises and opt-in demo dependencies. Accepted only after Gate B.
