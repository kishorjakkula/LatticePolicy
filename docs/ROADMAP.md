# LatticePolicy Roadmap

This roadmap organizes the work required to move LatticePolicy from an
open-source policy administration starter framework toward an insurance and
reinsurance platform kernel that can support carriers, MGAs/MGUs, reinsurers,
delegated authority models, and large commercial operations.

The executable GitHub roadmap starts at issue
[#69](https://github.com/kishorjakkula/LatticePolicy/issues/69).

## Vision

LatticePolicy should provide the core policy, underwriting, exposure, document,
transaction, audit, and integration-event capabilities needed by insurance and
reinsurance platforms.

Billing, payment accounting, claim financial accounting, and commission
settlement may be handled by separate applications. LatticePolicy must still
emit reliable policy transaction, premium-impact, exposure, document, and
reinsurance handoff events so those systems can trust it.

## Roadmap Structure

| Phase | Goal | GitHub Epic |
| --- | --- | --- |
| Phase 1 | Carrier pilot readiness | [#70](https://github.com/kishorjakkula/LatticePolicy/issues/70) |
| Phase 2 | Insurance platform readiness | [#71](https://github.com/kishorjakkula/LatticePolicy/issues/71) |
| Phase 3 | Reinsurance compatibility | [#72](https://github.com/kishorjakkula/LatticePolicy/issues/72) |
| Phase 4 | ACORD and GRLC data compatibility | [#73](https://github.com/kishorjakkula/LatticePolicy/issues/73) |
| Phase 5 | Product governance and filing readiness | [#74](https://github.com/kishorjakkula/LatticePolicy/issues/74) |
| Phase 6 | Enterprise security and compliance readiness | [#75](https://github.com/kishorjakkula/LatticePolicy/issues/75) |
| Phase 7 | Production operations and integration readiness | [#76](https://github.com/kishorjakkula/LatticePolicy/issues/76) |

## Phase 1: Carrier Pilot Readiness

Goal: make LatticePolicy usable for a controlled carrier pilot with real
operational workflows, limited products, and clear boundaries to external
systems.

Expected outcomes:

- Stable policy transaction lifecycle.
- Idempotent policy-changing APIs.
- Consistent API response and error contracts.
- Complete document generation hooks for core policy transactions.
- Hardened underwriting referral workflow.
- Product pack extension guide.
- Automation coverage for critical policy flows.
- Carrier onboarding and go-live certification kit.

Issues:

- [#47 Complete policy document generation service](https://github.com/kishorjakkula/LatticePolicy/issues/47)
- [#48 Add notification and notice framework](https://github.com/kishorjakkula/LatticePolicy/issues/48)
- [#50 Harden underwriting referral workflow](https://github.com/kishorjakkula/LatticePolicy/issues/50)
- [#51 Standardize policy transaction state machine](https://github.com/kishorjakkula/LatticePolicy/issues/51)
- [#54 Standardize API response and error contracts](https://github.com/kishorjakkula/LatticePolicy/issues/54)
- [#55 Add idempotency for policy-changing APIs](https://github.com/kishorjakkula/LatticePolicy/issues/55)
- [#56 Document and enforce product pack extension contract](https://github.com/kishorjakkula/LatticePolicy/issues/56)
- [#59 Expand automation coverage for full policy transaction functionality](https://github.com/kishorjakkula/LatticePolicy/issues/59)
- [#66 Create carrier onboarding and go-live certification kit](https://github.com/kishorjakkula/LatticePolicy/issues/66)

## Phase 2: Insurance Platform Readiness

Goal: elevate LatticePolicy from a starter PAS into a reusable insurance
operations platform for carriers, MGAs/MGUs, and delegated authority models.

Expected outcomes:

- Producer commission handoff events without owning commission settlement.
- Tenant-aware notification and notice workflow.
- Compliance admin workflows for state eligibility and OFAC review.
- Full internal audit and replay UI.
- Batch and scheduler framework for policy operations.
- Operational admin dashboards.
- Exposure management and aggregation views.
- Legacy book import and migration framework.

Issues:

- [#46 Add producer commission handoff events](https://github.com/kishorjakkula/LatticePolicy/issues/46)
- [#48 Add notification and notice framework](https://github.com/kishorjakkula/LatticePolicy/issues/48)
- [#49 Build compliance admin workflows for OFAC and state eligibility](https://github.com/kishorjakkula/LatticePolicy/issues/49)
- [#53 Build complete policy audit and replay UI](https://github.com/kishorjakkula/LatticePolicy/issues/53)
- [#57 Add batch and scheduler framework for policy operations](https://github.com/kishorjakkula/LatticePolicy/issues/57)
- [#58 Add operational admin dashboards](https://github.com/kishorjakkula/LatticePolicy/issues/58)
- [#63 Add exposure management and aggregation views](https://github.com/kishorjakkula/LatticePolicy/issues/63)
- [#67 Build data migration and legacy book import framework](https://github.com/kishorjakkula/LatticePolicy/issues/67)

## Phase 3: Reinsurance Compatibility

Goal: support reinsurance, large commercial, treaty/facultative placement,
bordereaux, and delegated authority reporting scenarios.

Expected outcomes:

- Reinsurance treaty and facultative placement model.
- Treaty/facultative lookup for policy transactions.
- Bordereaux generation and validation.
- Exposure aggregation by product, geography, period, program, and treaty.
- Large commercial placement and subscription workflow.
- Out-of-sequence transaction handling beyond endorsements where needed.

Issues:

- [#60 Add ACORD and GRLC canonical data mapping layer](https://github.com/kishorjakkula/LatticePolicy/issues/60)
- [#61 Add reinsurance treaty and facultative placement model](https://github.com/kishorjakkula/LatticePolicy/issues/61)
- [#62 Build bordereaux generation and validation framework](https://github.com/kishorjakkula/LatticePolicy/issues/62)
- [#63 Add exposure management and aggregation views](https://github.com/kishorjakkula/LatticePolicy/issues/63)
- [#64 Support large commercial placement and subscription workflow](https://github.com/kishorjakkula/LatticePolicy/issues/64)
- [#52 Extend out-of-sequence handling beyond endorsements](https://github.com/kishorjakkula/LatticePolicy/issues/52)

## Phase 4: ACORD And GRLC Data Compatibility

Goal: add a standards-aware compatibility layer for ACORD P&C and ACORD Global
Reinsurance & Large Commercial style integrations.

Expected outcomes:

- Canonical mapping models for parties, policies, submissions, risks,
  coverages, transactions, premium impacts, documents, exposures, and
  reinsurance placement fields.
- Import and export mapping interfaces.
- Fixture-based examples for insurance and reinsurance payloads.
- Structured validation errors for mapping failures.
- Carrier onboarding worksheets for mapping decisions.

Issues:

- [#60 Add ACORD and GRLC canonical data mapping layer](https://github.com/kishorjakkula/LatticePolicy/issues/60)
- [#62 Build bordereaux generation and validation framework](https://github.com/kishorjakkula/LatticePolicy/issues/62)
- [#64 Support large commercial placement and subscription workflow](https://github.com/kishorjakkula/LatticePolicy/issues/64)
- [#66 Create carrier onboarding and go-live certification kit](https://github.com/kishorjakkula/LatticePolicy/issues/66)
- [#67 Build data migration and legacy book import framework](https://github.com/kishorjakkula/LatticePolicy/issues/67)

## Phase 5: Product Governance And Filing Readiness

Goal: add product lifecycle governance required for filed carrier products and
reinsurer-facing program management.

Expected outcomes:

- Product, rate, form, underwriting rule, and jurisdiction lifecycle states.
- Effective-dated rating/form/rule versions.
- Filing status and approval audit.
- State availability management.
- Product readiness certification tests.

Issues:

- [#49 Build compliance admin workflows for OFAC and state eligibility](https://github.com/kishorjakkula/LatticePolicy/issues/49)
- [#56 Document and enforce product pack extension contract](https://github.com/kishorjakkula/LatticePolicy/issues/56)
- [#47 Complete policy document generation service](https://github.com/kishorjakkula/LatticePolicy/issues/47)
- [#60 Add ACORD and GRLC canonical data mapping layer](https://github.com/kishorjakkula/LatticePolicy/issues/60)
- [#66 Create carrier onboarding and go-live certification kit](https://github.com/kishorjakkula/LatticePolicy/issues/66)

## Phase 6: Enterprise Security And Compliance Readiness

Goal: prepare LatticePolicy for enterprise carrier/reinsurer security, privacy,
access governance, and compliance expectations.

Expected outcomes:

- Enterprise SSO and external identity claim mapping.
- Production-safe demo-mode restrictions.
- Strong tenant isolation and authorization controls.
- Sensitive-data access audit and PII reveal workflow.
- Security and compliance evidence available to admins.
- Production backup, restore, and disaster recovery runbooks.

Issues:

- [#65 Add enterprise identity and security controls for carrier deployment](https://github.com/kishorjakkula/LatticePolicy/issues/65)
- [#49 Build compliance admin workflows for OFAC and state eligibility](https://github.com/kishorjakkula/LatticePolicy/issues/49)
- [#53 Build complete policy audit and replay UI](https://github.com/kishorjakkula/LatticePolicy/issues/53)
- [#54 Standardize API response and error contracts](https://github.com/kishorjakkula/LatticePolicy/issues/54)
- [#55 Add idempotency for policy-changing APIs](https://github.com/kishorjakkula/LatticePolicy/issues/55)
- [#58 Add operational admin dashboards](https://github.com/kishorjakkula/LatticePolicy/issues/58)
- [#68 Add production deployment, backup, restore, and disaster recovery runbooks](https://github.com/kishorjakkula/LatticePolicy/issues/68)

## Phase 7: Production Operations And Integration Readiness

Goal: prepare LatticePolicy for production operations and reliable integration
with surrounding insurance systems.

Expected outcomes:

- Idempotent, tenant-scoped, observable integration events.
- Durable jobs with retry and failure tracking.
- Operational dashboards for outbox, jobs, documents, notifications,
  compliance, and audit exceptions.
- Deployment, migration, rollback, backup, restore, and incident runbooks.
- Production smoke tests and validation steps.

Issues:

- [#46 Add producer commission handoff events](https://github.com/kishorjakkula/LatticePolicy/issues/46)
- [#48 Add notification and notice framework](https://github.com/kishorjakkula/LatticePolicy/issues/48)
- [#55 Add idempotency for policy-changing APIs](https://github.com/kishorjakkula/LatticePolicy/issues/55)
- [#57 Add batch and scheduler framework for policy operations](https://github.com/kishorjakkula/LatticePolicy/issues/57)
- [#58 Add operational admin dashboards](https://github.com/kishorjakkula/LatticePolicy/issues/58)
- [#62 Build bordereaux generation and validation framework](https://github.com/kishorjakkula/LatticePolicy/issues/62)
- [#67 Build data migration and legacy book import framework](https://github.com/kishorjakkula/LatticePolicy/issues/67)
- [#68 Add production deployment, backup, restore, and disaster recovery runbooks](https://github.com/kishorjakkula/LatticePolicy/issues/68)

## Execution Model

Use GitHub issue [#69](https://github.com/kishorjakkula/LatticePolicy/issues/69)
as the master roadmap epic. Each phase has its own epic issue with task-list
links to implementable issues.

Recommended GitHub Project fields:

- Status: Inbox, Needs Analysis, Ready, In Progress, In Review, Blocked, Done.
- Priority: P0, P1, P2.
- Readiness: Demo, Pilot, Production.
- Domain: Policy, Underwriting, Documents, Compliance, Reinsurance, Exposure,
  Integration, Security, Operations, Product.
- Size: S, M, L, XL.
- Owner.

## Phase Definition Of Done

A roadmap phase is complete when:

- Linked issues are complete or intentionally deferred with a documented reason.
- Documentation and AI-readable task context are updated.
- Automated tests are added or updated for behavior changes.
- Tenant isolation, security, and integration boundaries are considered.
- Carrier/reinsurance adoption impact is documented.
