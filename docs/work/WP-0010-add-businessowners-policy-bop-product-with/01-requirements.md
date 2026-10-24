# Requirements — WP-0010

Gate A approved by Kishor Kumar Jakkula with "Approved" after the three proposed
scope defaults were presented. No BOP code or data changes have been made.

## Business goal

Enable agents and underwriters to demonstrate a coherent Businessowners Policy
(BOP) submission, quote, bind, issue and servicing flow, with synthetic data,
an appropriate underwriting company and an authorized agency/producer.

## Scope

- Lines: small-business property, business income/extra expense and liability.
- Jurisdiction: proposed US/Ohio local-demo scope; no admission/filing claim.
- Transactions: new business through issue, then existing endorsement,
  cancellation, reinstatement, renewal, rewrite and non-renewal paths, each
  advertised only after applicable lifecycle tests pass.
- Roles: existing authorized agents, underwriters and carrier administrators.
- Proposed appetite: low-hazard office, retail and service businesses;
  owner/tenant cases, initially one premises, 12-month terms.
- Use existing product/submission/quote screens, not a separate BOP application.

## Requirements

| ID | Requirement | Source (filed rule, guideline, law, product decision) |
| --- | --- | --- |
| REQ-1 | Discover BOP in existing product, submission and quote flows with appropriate business/location fields and structured addresses. | User; PRODUCT_PACK_CONTRACT.md |
| REQ-2 | Offer business personal property, business income/extra expense and occurrence-based business liability; building coverage conditional on ownership/insurable interest. Distinguish property values, occurrence limits and aggregates. | NAIC/Triple-I baseline; proposed package |
| REQ-3 | Provide configurable limits/deductibles, medical expenses and proposed optional equipment breakdown/water backup; explicit income trigger/basis/period. | Proposed demo choices, not universal standards |
| REQ-4 | Capture operations/classification, sales, relevant payroll, employees, loss history, years in business, occupancy, building construction/age, area and protections. | Proposed demo underwriting requirements |
| REQ-5 | Produce reproducible component pricing with explanatory traces and pinned versions; clearly synthetic/non-filed rates, fees and tax assumptions. | Existing rating framework; proposed demo pricing |
| REQ-6 | Enforce configurable required fields, package relationships, eligibility, decline/referral and authority at relevant screen/rate/bind/issue stages. | VALIDATION_RULES.md; existing underwriting framework |
| REQ-7 | Provide tenant-scoped state eligibility, fictional underwriting company and agency/producer relationships and authorizations required by existing flows. | User; existing dependency model |
| REQ-8 | Supply opt-in repeatable synthetic customers, owner/tenant risks, quote/policy examples and intake upload/expected results; re-running must not duplicate or overwrite unrelated data. | User; repository safety rules |
| REQ-9 | Supply original demo quote/binder/declarations through transaction-level forms configuration, retaining historical editions; label outputs non-contractual. | Existing forms framework; proposed base setup |
| REQ-10 | Automate discovery, UI/fields, rating, validation, underwriting, dependency/tenant isolation, intake and supported lifecycle tests; update handoff docs. | AGENTS.md; TEST_PLAN.md |

## Acceptance criteria

1. REQ-1: Given an eligible tenant, when BOP is selected, then matching fields
   load in existing flows; unknown products are rejected rather than misrouted.
2. REQ-2: Given a tenant business without building interest, when configuring
   coverage, then BPP/income/liability work without invented building coverage;
   foreign coverage codes and incomplete required packages are rejected.
3. REQ-3: Given configured limits, when rating, then valid selections persist;
   invalid values or incompatible periods/limits fail with actionable errors.
4. REQ-4: Given complete risk/contact data, when saving and reviewing, then it
   survives round trips; missing required facts never become safe assumptions.
5. REQ-5: Given fixed inputs and version, when rating twice, then totals/traces
   agree; deselected optional parts add no charge and history is not rewritten.
6. REQ-6: Given configured referral/decline criteria, when binding, then the
   appropriate gate applies; unauthorized approvals and stale decisions fail.
7. REQ-7: Given active matching company/agency records, when an authorized
   producer quotes, then the correct company is available; wrong-state,
   inactive, unappointed or cross-tenant relationships fail where applicable.
8. REQ-8: Given a demo tenant, when setup runs twice, then records stay unique.
   When the intake file is processed, expected values appear without customer
   or quote creation until authorized human approval.
9. REQ-9: Given an issued transaction, when templates change, then its historic
   document stays pinned; generated demo outputs carry non-contract warnings.
10. REQ-10: Given BOP and existing products, when automated checks run, then
    positive, negative and regression cases pass with recorded evidence.

## Business rules

- NAIC describes the typical property, business interruption and liability
  package; auto, workers compensation and professional liability are not
  automatically included: https://content.naic.org/consumer/small-business.htm
- Triple-I describes income/extra expense and business eligibility factors:
  https://www.iii.org/publication/insurance-handbook/insurance-basics/small-business-insurance-basics-3
- Sources checked 2026-10-23. Internal knowledge index/checklist last reviewed
  2026-10-17, within their review intervals. These sources do not supply this
  carrier's filed pricing, eligibility thresholds, limits or policy wording.
- All numerical limits, deductibles, income periods/waiting periods, class
  codes and premium examples are proposed carrier/demo choices for Gate B.
- Do not treat liability aggregates as separately charged duplicate coverage.
  Do not claim unlimited or actual-loss-sustained income unless represented.

## Regulatory and compliance notes

State admission, filed rates/forms, licensed distribution, mandatory
endorsements, terrorism offer/disclosures and servicing notice requirements
need carrier/legal confirmation before real use. No invented universal notice
periods, copied proprietary ISO wording or claims of filing approval. Existing
compliance gates remain authoritative and must not be bypassed in tests.

## Out of scope and assumptions

- Demo foundation, not a legally approved insurance offering or production launch.
- No financial ledger, premium collection or claims adjudication.
- No automatic public AI calls/training or AI acting as a human approver.
- No automatic inclusion of auto, workers compensation, E&O or cyber.
- Multi-location aggregation is not assumed supported in phase one; confirm scope.
- No local runtime/data changes until the appropriate setup/deployment approval.

## Questions and answers

| # | Question | Recommended default | Answer |
| --- | --- | --- | --- |
| 1 | State and intended use: which jurisdiction, admitted or surplus lines? | Ohio-only demo/test; real market status and filings deferred. | Approved |
| 2 | Business classes and number of locations? | Low-hazard office/retail/service; owner and tenant cases; initially single-location. | Approved |
| 3 | Coverages, dependencies and transactions? | Core package above, optional equipment breakdown/water backup, fictional demo company/agency/producer, 12-month term, synthetic pricing/forms, existing lifecycle flows. | Approved |

Gate A is complete. Design, detailed demo values, UI embedding and the test
plan require separate Gate B approval before implementation.
