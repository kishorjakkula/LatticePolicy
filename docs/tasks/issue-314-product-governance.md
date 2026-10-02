# Issue 314: Product Governance Releases

## Goal

Govern product editions, rating versions, underwriting rules, coverages, and
form editions as one effective-dated release. Quotes and policies retain the
exact approved configuration lineage used for production.

## Design

- `product_governance_releases` stores an immutable artifact snapshot and its
  canonical SHA-256 digest.
- Releases follow `DRAFT -> REVIEW -> APPROVED -> SCHEDULED -> ACTIVE -> RETIRED`.
  An approved release may also move directly to active for an immediate launch.
- The submitter cannot approve the same release. Every transition is written to
  `product_governance_audit` with actor, time, status change, and reason.
- Activation locks the release row and rejects an overlapping active release
  for the same tenant, product, and jurisdiction.
- Quote rating resolves the most specific active release for the quote's
  product, state, and effective date. It pins the release ID, version, digest,
  dates, and artifact snapshot in `payload.governanceLineage`.
- Bind carries the pinned lineage into transaction/policy-version metadata and
  stores the governed version on the policy projection. The policy UI displays
  the governed product version.
- A tenant with no governed release remains compatible with legacy YAML packs;
  once an active release exists, new quotes are pinned automatically.

## API And Validation

Routes under `/v1/product-governance/releases` support list, create, submit,
approve, schedule, activate, retire, and audit history. Permissions separate
read, manage, and approve duties. Unit tests cover lifecycle, maker-checker
separation, canonical hashing, and effective-date overlap behavior.
