---
title: P&C insurance knowledge — quick reference
last_reviewed: 2026-10-17
review_every_days: 90
sources: research/pc-insurance-domain-primer.md and research/underwriting-process-deep-dive.md (inline citations there)
---

# P&C Insurance Knowledge

A quick reference for the business analyst and other agents. Facts below are
summarized from the sourced research in [`research/`](research/); follow the
citations there before relying on a figure, and confirm state-specific rules
for the states in scope.

- [Domain primer](research/pc-insurance-domain-primer.md): lines, lifecycle,
  authority, rating, distribution, forms, claims, reinsurance, regulation, glossary.
- [Underwriting deep dive](research/underwriting-process-deep-dive.md): triage,
  clearance, classification, appetite, authority grids, renewal, profitability.
- [Requirements checklist](requirements-checklist.md): questions the business
  analyst works through for every request.

## Lines of business

- **Personal lines** (auto, homeowners) are standardized and rated mostly by
  algorithm. **Commercial lines** are judgment-driven: four liability exposures
  (premises, operations, products, completed operations).
- **HO-3**: open-peril on the dwelling, named-peril on personal property.
- **Workers' compensation** rates on payroll by class code, adjusted by the
  experience modifier (1.0 = average).
- **CGL** is occurrence or claims-made (claims-made ties to a retroactive date).
- **Commercial auto** vs personal auto (business use excluded); **HNOA** fills
  the hired and non-owned gap.
- **Cyber**: first-party breach response plus third-party liability; distinct
  from tech E&O.
- **BOP** (fixed package for small business) vs **CPP** (choose coverage parts).

## Policy lifecycle — each is a distinct transaction, not a status flag

| Transaction | Meaning | System implication |
| --- | --- | --- |
| Quote | Non-binding premium estimate | No coverage; may expire |
| Bind | Coverage in force, often via a binder (commonly 30–90 days) | Authority and referral checks apply |
| Issue | Full policy documents replace the binder | Documents, notices, billing start |
| Endorsement | Mid-term change; pro rata additional or return premium on days remaining | Effective date and days remaining drive premium; deductibles usually cannot be reduced mid-term |
| Cancellation | Ends before expiry; after ~60 days in force usually limited by state law to listed causes (nonpayment, fraud/misrepresentation, increased hazard); notice commonly 10–60 days by state | State-specific reasons and notice periods |
| Non-renewal | Lets the term expire; fewer limits on reasons but advance notice required (example: NY homeowners 45–60 days) | Main lever for exiting geography or classes; regulator-gated in some states |
| Reinstatement | Reverses a cancellation with no gap (reinstated as of the cancellation date) | Status change on the same policy |
| Rewrite | Cancels and issues a new policy (gap, correction, account move) | Two linked policy records |
| Renewal | New term, usually same policy number; renewal underwriting starts 60–120 days before expiry | Re-score against current appetite and rates |

## Underwriting and authority

- Outcomes go beyond accept/decline: refer, accept with modified terms
  (deductible, exclusion, sublimit), bind subject to conditions (subjectivities).
- **Binding authority** cascades carrier → MGA/MGU → agent, bounded by per-risk
  and aggregate limits, classes, territories and **referral triggers**. Carriers
  oversee delegated business through audit and **bordereaux**.
- Appetite is enforced by rules; risks outside it may go to surplus lines or
  state FAIR plans.

## Rating

- Premium = base rate × rating relativities (territory, construction, vehicle,
  history…), typically estimated with GLMs.
- **ISO** publishes advisory loss costs; carriers apply a filed loss cost
  multiplier or file proprietary rates.
- Rates must be **not excessive, not inadequate, not unfairly discriminatory**
  (CAS: actuarially sound), filed mostly through **SERFF** under prior approval,
  file-and-use, use-and-file or flex rating, by state.

## Forms and documents

- Declarations (instance data) + insuring agreement, exclusions, conditions
  (base form) + endorsements (overrides, higher precedence).
- Form sources: ISO (standard), proprietary (company), manuscript (one insured).
- Forms are filed by state like rates; using an unapproved form is a violation.
- **ACORD** standardizes applications (ACORD 125), certificates (ACORD 25 — does
  not change the policy) and electronic data exchange.

## Regulation

- Regulated **state by state** (McCarran-Ferguson Act, 1945); up to 56
  jurisdictions for rates, forms and licensing.
- **NAIC** coordinates (model laws, accreditation, SERFF) but has no authority of
  its own; model laws apply only when a state adopts them.
- **Admitted** carriers file rates and forms and are backed by guaranty funds;
  **surplus lines** are not, need a diligent search (commonly three
  declinations), and are regulated by the insured's home state (NRRA).
- Solvency: risk-based capital, statutory accounting, guaranty associations.

## Where LatticePolicy implements these

| Concept | LatticePolicy |
| --- | --- |
| Products, coverages, rating keys | `products/<code>/coverage.yaml`, `rates.yaml`, carrier packs (`docs/PRODUCT_PACK_CONTRACT.md`) |
| Lifecycle transactions | `server/src/services/lifecycle.service.ts`, `endorsement.service.ts`, `quote-bind.service.ts`, `server/src/routes/transactions.routes.ts` |
| Rating | `server/src/services/rating.service.ts`, rating workbench |
| Underwriting rules and referrals | `docs/tasks/admin-underwriting-rules-engine.md`, `uw.service.ts`, `uw-referral.service.ts` |
| Underwriting authority | migration `053_underwriting_authority.sql`, underwriting authority admin |
| Forms and documents | forms admin, `document-generation.service.ts`, product document templates |
| Cancellation and non-renewal compliance | `servicing_compliance_rules` (migration 052) |
| Configurable validations at every level | `docs/VALIDATION_RULES.md` |
| Reinsurance and bordereaux | `docs/REINSURANCE_MODEL.md`, bordereaux admin |
| Submission intake (AI drafting, human approval) | `docs/SUBMISSION_INTAKE.md` |
| ACORD alignment | `docs/ACORD_GRLC_MAPPING.md` |
