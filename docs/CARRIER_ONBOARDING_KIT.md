# Carrier Onboarding And Go-Live Certification Kit

This kit is the practical implementation path for a carrier, reinsurer,
MGA/MGU, or contributor adopting LatticePolicy: fork/install to a configured
tenant and product, through demo, pilot, and production readiness. It
references the existing setup, product, security, and roadmap docs rather
than duplicating them, and lists the automated tests that back each
readiness tier.

Use `docs/tasks/TEMPLATE.md` to write an implementation-specific task note
under `docs/tasks/` when a step below requires carrier-specific decisions or
follow-up work.

## Readiness Tiers

Match the `readiness:*` label taxonomy used on GitHub issues
(`docs/GITHUB_ROADMAP_SETUP.md`):

| Tier | Meaning | Typical use |
| --- | --- | --- |
| Demo | Single tenant, sample product data, no external integrations required. | Evaluation, internal proof of concept. |
| Pilot | Real tenant/product configuration, controlled user group, real but limited transaction volume. | Controlled carrier pilot. |
| Production | Full security, backup/DR, monitoring, and integration event contracts in place. | General availability for a carrier. |

Every checklist item below is tagged with the tier it is required for.

## 1. Carrier Onboarding Checklist

1. **(Demo)** Fork/clone the repository and complete
   `docs/DEVELOPER_SETUP.md` (Node 20, `npm install`, `docker compose up -d
   --build`, verify `http://localhost:3300/health`).
2. **(Demo)** Review `docs/PROJECT_CONTEXT.md` and `docs/ARCHITECTURE.md` for
   the domain model, tenant model, and access-based UI/API design.
3. **(Pilot)** Create a real tenant under `tenants/<tenant>/` (see
   `docs/MULTITENANCY.md`) and configure branding, roles, and product
   availability for that tenant.
4. **(Pilot)** Select which product packs the tenant sells (see Section 2)
   and confirm state eligibility rows exist for every state/product
   combination the tenant will quote (`policy_eligibility` table, see
   `server/src/lib/policy-compliance.ts`; admin workflow added in
   [#49](https://github.com/kishorjakkula/LatticePolicy/issues/49)).
5. **(Pilot)** Configure RBAC roles and users for the tenant's internal staff
   (admin, underwriter, agent, actuary) per `server/src/lib/rbac.ts`; keep
   customer accounts scoped through `users.customer_id` /
   `policy_customer_links` as described in the README's access model.
6. **(Pilot)** Configure the notification framework
   (`docs/NOTIFICATIONS.md`) with tenant-specific templates for the
   transaction types the tenant will run in the pilot.
7. **(Production)** Complete Sections 5–8 below (integration events,
   security, deployment/go-live, certification tests) before expanding past
   a controlled pilot group.

## 2. Tenant/Product Setup Guide

Do not duplicate implementation detail here — follow these docs directly:

- Local and tenant setup mechanics: `docs/DEVELOPER_SETUP.md`.
- Adding or configuring a product pack: `docs/PRODUCT_PACK_CONTRACT.md` —
  this is the canonical reference for `coverage.yaml`, `rates.yaml`, tenant
  field metadata, state eligibility rows, forms catalog rows, and the
  framework code paths that still require a matching code edit for a new
  product code (`server/src/lib/products.ts`,
  `server/src/routes/products.routes.ts`,
  `server/src/services/rating.service.ts`,
  `frontend/src/features/wizard/QuoteWizard.tsx`).
- Domain model and lifecycle: `docs/DOMAIN.md`.

## 3. Product/State/Form/Rating Versioning Checklist

- **(Pilot)** Every product pack ships `product:` and `version:` fields in
  both `coverage.yaml` and `rates.yaml` (required by
  `docs/PRODUCT_PACK_CONTRACT.md`); bump `version:` when rates or coverage
  structure change and keep prior versions retrievable for in-force policies
  rated under them.
- **(Pilot)** State eligibility rows are effective-dated and carry a status
  (`active`, `suspended`, `closed`, `filing pending`) per tenant/product/state
  — see the compliance admin workflow in
  [#49](https://github.com/kishorjakkula/LatticePolicy/issues/49).
- **(Pilot)** Forms are cataloged in `forms_catalog` with `applicability`
  scoped by product/state/transaction type (`server/migrations/001_init.sql`);
  confirm every transaction type the tenant will run has a matching form set
  before go-live, including servicing transactions
  ([#89](https://github.com/kishorjakkula/LatticePolicy/issues/89), merged).
- **(Production)** Track filed-vs-draft status for product, rate, and form
  versions per jurisdiction. Formal filing lifecycle governance
  (approval audit, state availability management beyond the eligibility
  table) is still open roadmap work — see Phase 5 in `docs/ROADMAP.md` and
  [#74](https://github.com/kishorjakkula/LatticePolicy/issues/74). Track a
  carrier-specific task note under `docs/tasks/` for any manual filing
  process the tenant relies on until that phase lands.

## 4. ACORD/GRLC Mapping Worksheet

LatticePolicy ships a first canonical ACORD/GRLC mapping layer — see
[ACORD and GRLC canonical data mapping](ACORD_GRLC_MAPPING.md)
(`server/src/lib/acord-mapping/`), covering a personal/commercial submission
flow and a reinsurance/large-commercial treaty flow, added by
[#60](https://github.com/kishorjakkula/LatticePolicy/issues/60). It is a
canonical JSON mapping structurally inspired by ACORD field names, not a
full ACORD XML/XSD binding — read that doc's Known Gaps section before
relying on it for a specific carrier integration. Use this worksheet to
record any additional mapping decisions the mapping layer doesn't yet cover.

For each ACORD/GRLC object type the carrier's integrations require, record:

| ACORD/GRLC object | LatticePolicy entity | Mapping notes | Gaps/custom fields |
| --- | --- | --- | --- |
| Party | `customers`, tenant user records | | |
| Policy | policy version/transaction tables (`docs/DOMAIN.md`) | | |
| Submission/Quote | quote records (`server/src/services/quote.service.ts`) | | |
| Risk/Coverage | `coverage.yaml` `ratingKeys`, policy coverage rows | | |
| Transaction | transaction/timeline records | | |
| Premium impact | rating trace, ledger events | | |
| Document | generated document/packet metadata ([#88](https://github.com/kishorjakkula/LatticePolicy/issues/88)) | | |
| Reinsurance placement | not yet modeled — see Section 5 | | |

Reference [#60](https://github.com/kishorjakkula/LatticePolicy/issues/60) and
open a linked implementation-specific issue for any mapping gap discovered
while completing this worksheet.

## 5. Reinsurance Setup Worksheet

Reinsurance treaty/facultative placement, bordereaux, and exposure
aggregation are open roadmap work (Phase 3, `docs/ROADMAP.md`):
[#61](https://github.com/kishorjakkula/LatticePolicy/issues/61) (treaty and
facultative placement model),
[#62](https://github.com/kishorjakkula/LatticePolicy/issues/62) (bordereaux
generation and validation), and
[#63](https://github.com/kishorjakkula/LatticePolicy/issues/63) (exposure
aggregation views). This worksheet captures what a reinsurance-facing
implementation needs to decide ahead of that work landing:

- Which programs/treaties will the tenant need represented (quota share,
  surplus, excess of loss, facultative)?
- What cession basis and reporting periods does each treaty require?
- What bordereaux format(s) does each reinsurer/broker require (premium
  bordereaux, loss bordereaux, cadence)?
- What exposure aggregation dimensions matter (product, geography, period,
  program, treaty) per
  [#63](https://github.com/kishorjakkula/LatticePolicy/issues/63)?
- What is the large commercial/subscription placement structure, if any,
  per [#64](https://github.com/kishorjakkula/LatticePolicy/issues/64)?

Record answers in a `docs/tasks/` task note and link it from the relevant
GitHub issue so the eventual implementation has real carrier requirements to
validate against.

## 6. Integration Event Checklist

LatticePolicy is designed to emit reliable events rather than own billing,
claims, or commission settlement (README, "Vision" in `docs/ROADMAP.md`).
Confirm each integration boundary before production go-live:

- **Billing**: policy issue/endorse/cancel/reinstate/renew premium-impact
  events. Standardized API/error contract work:
  [#54](https://github.com/kishorjakkula/LatticePolicy/issues/54).
- **Claims**: policy/coverage lookup contract for claims systems — confirm
  which read APIs the tenant's claims system depends on and add contract
  tests if they are novel.
- **Commission**: producer commission handoff events — see
  `docs/COMMISSION_HANDOFF.md` and
  [#46](https://github.com/kishorjakkula/LatticePolicy/issues/46) (merged).
- **Documents**: generated document/packet events and retrieval — see
  [#88](https://github.com/kishorjakkula/LatticePolicy/issues/88) and
  [#86](https://github.com/kishorjakkula/LatticePolicy/issues/86) (merged).
- **Notifications**: tenant-aware notification framework — see
  `docs/NOTIFICATIONS.md` and
  [#48](https://github.com/kishorjakkula/LatticePolicy/issues/48) /
  [#87](https://github.com/kishorjakkula/LatticePolicy/issues/87) (merged).
- **Data warehouse**: confirm what read/export path the tenant's analytics
  stack needs; there is no dedicated export framework yet — track it as a
  carrier-specific task note if required for go-live.
- **Idempotency**: all policy-changing APIs support `Idempotency-Key` with
  reservation locking — see
  [#90](https://github.com/kishorjakkula/LatticePolicy/issues/90) (merged)
  and [#55](https://github.com/kishorjakkula/LatticePolicy/issues/55).

## 7. Security/Deployment/Go-Live Checklist

- **(Pilot)** Complete local and cloud deployment setup per
  `docs/DEVELOPER_SETUP.md` and `docs/CLOUD_DEPLOYMENT.md`
  (`docs/GITHUB_ACTIONS_AWS.md` / `docs/GITHUB_ACTIONS_AZURE.md` for CI/CD
  deployment specifics).
- **(Pilot)** Review `SECURITY.md` for the vulnerability reporting process
  and confirm demo credentials are not carried into the tenant's
  environment (`AGENTS.md` safety rules: keep demo credentials
  local/demo-only).
- **(Pilot)** Confirm RBAC and tenant isolation checks are enforced
  server-side for every route the tenant will use, per the review priorities
  in `CONTRIBUTING.md`.
- **(Production)** Enterprise SSO/external identity mapping — open roadmap
  work, see [#65](https://github.com/kishorjakkula/LatticePolicy/issues/65)
  (Phase 6, `docs/ROADMAP.md`).
- **(Production)** Follow `docs/PRODUCTION_RUNBOOKS.md` for deployment
  promotion, migration execution/rollback, database backup/restore,
  Redis/cache recovery, health checks, incident response, and RPO/RTO
  validation. Treat the runbook's restore-test and smoke-test checklist as
  go-live prerequisites, not optional launch cleanup.
- **(Production)** Run `npm run security:audit` and resolve findings before
  go-live; keep it in CI per `docs/TEST_PLAN.md`.

## 8. Certification Test Suite Plan

Map go-live confidence to the test layers in `docs/TEST_PLAN.md`:

| Area | Required layer | Reference |
| --- | --- | --- |
| Rating for each product the tenant sells | Unit | `server/src/services/__tests__/rating.service.test.ts` |
| Quote → bind → policy for each product | DB-backed integration | `server/src/__tests__/quote-to-bind.integration.test.ts` |
| Servicing transactions (endorse, cancel, reinstate, renew, rewrite, non-renew) | DB-backed integration | `server/src/__tests__/policy-lifecycle.integration.test.ts` |
| RBAC/tenant isolation for tenant's configured roles | API tests | `docs/TEST_PLAN.md` "API Tests Without Database" |
| Customer portal scope | DB-backed integration | `server/src/__tests__/customer-portal-security.integration.test.ts` |
| Underwriting referral gating | DB-backed integration | see [#50](https://github.com/kishorjakkula/LatticePolicy/issues/50) (merged) integration tests |
| Compliance (OFAC, eligibility) | DB-backed integration | see [#49](https://github.com/kishorjakkula/LatticePolicy/issues/49) integration tests |
| Notifications for configured templates | Unit + integration | `docs/NOTIFICATIONS.md` |
| Idempotent write behavior | Unit | `server/src/lib/__tests__/idempotency.test.ts` |
| Critical user journeys (agent quote-to-bind, UW referral review, customer portal) | Playwright E2E | `docs/TEST_PLAN.md` "End-To-End Tests" |

A tenant is go-live ready when every product it sells has passing coverage
in the first two rows, every transaction type it will run has passing
coverage in the third row, and the Playwright E2E suite passes against a
Docker Compose deployment configured for that tenant
(`npm run test:e2e:docker`).

## Related Docs And Issues

- `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/DOMAIN.md`
- `docs/PRODUCT_PACK_CONTRACT.md`
- `docs/DATA_IMPORT_TEMPLATES.md` — legacy book import template field mappings
- `docs/NOTIFICATIONS.md`, `docs/MULTITENANCY.md`
- `docs/ROADMAP.md`, `docs/GITHUB_ROADMAP_SETUP.md`
- `docs/TEST_PLAN.md`
- GitHub Phase 1 epic: [#70](https://github.com/kishorjakkula/LatticePolicy/issues/70)
