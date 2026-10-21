# WP-0004: Proposal-Specific Referral Decisions

## Authorization And Scope

Kishor Jakkula approved the Gate B design extension on 2026-10-21 with
"approved." See `docs/work/WP-0004-fix-the-ui-and-flow-issues-from-the/02a-referral-proposal-binding.md`.
This is implementation approval, not permission to merge or deploy production.

## Implementation

- Migration 067 adds nullable `proposal_hash` and `proposal_snapshot` evidence
  to tenant-protected referrals. Existing rows remain unknown, not backfilled.
  A database trigger prevents rewriting either evidence column.
- Server canonicalization sorts object keys, preserves array order, includes
  tenant/resource/transaction/date/reasons and policy version/timeline state,
  proposed business data, rated money and underwriting/authority evaluation.
  Calculation trace diagnostics are excluded; changed money is not.
- Arbitrary carrier business fields remain available for review. Credential,
  document, attachment and binary fields are digest-only, never copied as
  plaintext into referral evidence. Evidence is not logged.
- New business, endorsement, renewal and rewrite supply server-evaluated
  context. Only an unconsumed Approved row with an exact fingerprint matches.
  Legacy, changed and consumed evidence requires fresh explicit review.
- Rejected policy mutations roll back first. An internal Symbol retains
  evaluated evidence across rollback without accepting request-provided hashes
  or rehashing already redacted snapshots. Retention serializes separately
  after releasing the policy lock. Quote gates serialize on a quote-scoped
  advisory lock; they do not hold policy row locks.
- Decision reads lock the referral row before recording the human outcome.
  Existing backend decision permissions and authority checks remain in place.
- The final new-business write transaction locks/revalidates the evaluated
  quote and its unconsumed approval before creating a policy, then consumes
  the approval in that same transaction. Concurrent binds cannot produce two
  policies from one approved quote. Changed quotes fail closed for re-evaluation.
- Referral lookup is scoped to the exact fingerprint before selecting the
  latest decision. An unrelated proposal does not shadow an earlier matching
  approval; a later decline/withdrawal for that fingerprint still blocks it.
- The UI recognizes only exact single-field SHA-256 redaction markers. Carrier
  fields named `redactedSha256` cannot suppress sibling risks/coverages.

## Verification

Final local results: frontend 586, server 942, fresh PostgreSQL integration 298,
isolated browser 161 passed. Root typecheck and explicit server build passed.
Audit policy passed with existing allowlisted Puppeteer/extract-zip advisories;
this does not mean there are zero known advisories. Independent Gibbs review
closed all three findings and reran 174 server / 29 frontend focused tests.
One reused-database full run failed due to accumulated fixtures; provisioning
a new disposable database restored all 298 tests without weakening assertions.
See the work package for historical runs, traceability and remaining human gates.
Demo/pilot stacks are unchanged; no merge or production deployment performed.
