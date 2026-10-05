# Task Note: Claims Reference Field For Bordereaux

## Links

- Issue: https://github.com/kishorjakkula/LatticePolicy/issues/225
- Pull request:

## Summary

Added a minimal, nullable `claim_reference` field to `policy_versions` so a
servicing transaction can be tagged with an external claim reference, and
gave the `CLAIMS_REFERENCE_HANDOFF` bordereau type its own row shape that
reports this field instead of reusing the generic `TRANSACTION` bordereau's
premium/cancellation fields. This is a reference/handoff field only — no
claims processing, adjudication, or financial data is modeled, matching the
scope boundary in `docs/ARCHITECTURE.md`.

## Important Files

- `server/migrations/046_claim_reference_field.sql`: adds
  `policy_versions.claim_reference` (nullable text).
- `server/src/schema.ts`: `policyVersions.claimReference`.
- `server/src/persistence.ts`: `InsertPolicyVersionArgs.claimReference` and
  `insertPolicyVersion` now persist it. This is the single shared insert
  point used by bind/endorse/cancel/reinstate/renew/rewrite/non-renewal, so
  any of those transaction types can pass a claim reference through without
  further plumbing changes.
- `server/src/services/lifecycle.service.ts`: `cancelPolicy` reads an
  optional `claimReference` from the request body (mirroring the existing
  `cancellationReasonCode` pattern), persists it via `insertPolicyVersion`,
  and records it in the transaction's `metadata` for timeline/audit
  visibility. Cancellation was chosen as the first wiring point because
  claims-driven cancellations (e.g. total loss) are the most common real
  case; other transaction types can adopt the same pattern later without
  schema changes.
- `server/src/services/bordereaux.service.ts`: `buildTransactionRows` now
  filters `CLAIMS_REFERENCE_HANDOFF` generation to only transactions with a
  non-null `claim_reference` (transactions without one are excluded from the
  batch entirely, not reported with a null reference), and builds a distinct
  row shape for that type (`transactionType`, `effectiveDate`,
  `claimReference`, `productCode`, `stateCode`, `treatyId`) instead of the
  premium/cancellation-oriented `TRANSACTION` shape.
  `validateBordereauRow` now requires `claimReference` for this type.

## Behavior Rules

- `claim_reference` is nullable and has no format validation — it is an
  opaque pointer to an external claims system's identifier.
- A `CLAIMS_REFERENCE_HANDOFF` bordereau only includes transactions that have
  a claim reference set; this keeps the report meaningful instead of
  dumping every transaction in the period under a claims-sounding label.
- The claim reference is settable today only through the cancellation
  request body (`claimReference` field). Extending this to other servicing
  transaction types is additive — `insertPolicyVersion` already accepts the
  field — and does not require another schema or framework change.

## Automated Tests

- Tests added or updated:
  - `server/src/services/__tests__/bordereaux.service.test.ts` — updated the
    existing CLAIMS_REFERENCE_HANDOFF validation test to include a claim
    reference, and added a test asserting `claimReference` is required for
    that type.
  - `server/src/__tests__/bordereaux.integration.test.ts` — new test
    generating a claims-handoff bordereau from two transactions (one with a
    claim reference, one without), asserting only the tagged one appears,
    and asserting the row/CSV shape is distinct from the generic
    transaction bordereau (no `premiumTotal`/`cancellationReasonCode`).
  - `server/src/__tests__/policy-lifecycle.integration.test.ts` — new test
    calling the real `cancelPolicy` service with a `claimReference` in the
    request body and asserting it persists to `policy_versions.claim_reference`
    and the transaction metadata.
- Test layer used: unit tests for the pure validation rule, DB-backed
  integration tests for the bordereaux generation path and the real
  cancellation API wiring.
- Why this layer is enough: the new behavior is a data field pass-through
  plus a filter/shape change in a report generator — both are fully
  exercised by these layers without needing E2E coverage.

## Validation

```bash
npm run build
npm run test
npm run typecheck
```

All three passed clean (101 frontend + 245 server unit tests). `npm run
test:integration` could not be run in this environment — Docker Desktop's
local storage is corrupted (`containerd` blob-store and metadata bolt-db I/O
errors), a pre-existing host issue unrelated to this change and already
flagged in earlier task notes/PRs this cycle. The new SQL (migration, raw
query column additions, Drizzle schema field) was manually cross-checked for
column-name consistency across all four touch points (migration, schema.ts,
persistence.ts, bordereaux.service.ts) in lieu of a live run. Recommend
confirming `test:integration` passes in CI or a clean environment before
merge.

## Follow-Ups Or Risks

- Only the cancellation transaction type currently exposes a way to set
  `claimReference`. Extending this to endorsement/reinstatement/renewal
  would be a small, additive follow-up (the shared `insertPolicyVersion`
  path already accepts the field).
- No excess-of-loss layer-stacking or claims-financial data is modeled here;
  this remains a reference/handoff field only, per the issue's explicit
  scope boundary.
