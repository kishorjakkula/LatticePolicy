# Data Migration And Legacy Book Import — Design

This document describes the staging-based import framework built for issue
#67, what already exists and works, and the design for the one remaining
entity type this issue's acceptance criteria requires: **policy**.

## Lifecycle (already implemented)

```
Upload/stage → Validate → Review → Commit → (Retry on failure)
```

- **Stage** (`stageImportBatch`): a batch of raw JSON rows is persisted as-is
  into `import_rows` with `status = 'Pending'`, under an `import_batches`
  parent row (`status = 'Staged'`). Up to 5000 rows per batch.
- **Validate** (`validateImportBatch`): every pending row is run through an
  entity-type-specific validator and marked `Valid` or `Invalid`. The
  validator is the *same* one the live admin API enforces at write time (see
  "Validation reuse" below) — there is no separate, looser pre-check that
  could pass a row here and then fail it at commit.
- **Review**: `listImportRows(..., status)` lets an operator see exactly
  which rows are `Invalid` and why (`validation_errors` is a JSON array of
  human-readable messages) before committing.
- **Commit** (`commitImportBatch`): only rows already marked `Valid` are
  attempted. A per-row failure does not fail the batch — it marks that row
  `Failed` with `error_message` and continues; the batch ends in
  `Committed` (all rows succeeded), `PartiallyCommitted` (some failed), or
  stays `Validated` if nothing was `Valid` to commit.
- **Retry** (`retryImportRow`): re-validates and re-attempts a single
  `Failed` row without re-running the whole batch.

## Row-level error reporting and reconciliation

- `import_rows.validation_errors` (pre-commit) and `.error_message`
  (commit-time failure) are both stored per row, so an operator reviewing a
  batch sees exactly which rows need fixing and why, without re-deriving
  anything.
- `import_batches` keeps running `row_count` / `valid_count` /
  `invalid_count` / `committed_count` / `failed_count` — the reconciliation
  summary is always available without a separate report step.
- `import_external_refs` (`tenant_id, entity_type, source_system,
  external_id` → `committed_entity_type, committed_entity_id`) is a generic,
  cross-batch, cross-entity-type ledger recorded on every successful commit.
  It answers "what did this legacy record become in LatticePolicy" for any
  entity type, independent of whether that entity type also has its own
  dedicated identity table.

## Idempotency and source-system identifiers

Two layers exist, and the right one to use depends on whether the entity
type has its own natural identity concept:

1. **Dedicated identity table** (customer): `customer_external_identifiers`
   is the real source of truth. Re-importing the same `sourceSystem`/
   `externalId` pair finds and updates the existing customer via
   `findExistingCustomerByExternalIdentifiers` — this is genuine upsert
   semantics, appropriate because a customer is simple master data.
2. **Generic ledger only** (policy, and anything else without its own
   identity table): `import_external_refs` is the sole idempotency check.
   Re-importing the same `sourceSystem`/`externalId` is detected there and
   the row is treated as already-committed (see "Policy commit handler"
   below) rather than re-run — **not** an upsert, because a policy is not
   master data. See "Why policy import is not an upsert" below.

## Tenant isolation and authorization

Unchanged by this design — already correctly enforced and unaffected by
adding a second entity type:

- Every table (`import_batches`, `import_rows`, `import_external_refs`) has
  tenant RLS, and every service function takes `tenantId` explicitly and
  runs inside `withTenantTx`/a request-scoped tenant context.
- `admin.import.read` / `admin.import.manage` permissions gate the API
  (`server/src/lib/rbac.ts`, `data_import_admin` role), enforced in
  `server/src/routes/data-import.routes.ts` the same way for every entity
  type — a new entity type does not need its own permission.

## Policy commit handler design (the new work)

### Why policy import is not a raw insert

A previous attempt at this stalled because it tried to write directly into
`policies`/`policy_transactions`/`policy_versions`, bypassing the policy
lifecycle state machine (`validatePolicyTransactionState` and the
transaction-sequencing rules `quote-bind.service.ts`/`lifecycle.service.ts`
enforce). That risks producing a policy row that looks real but has none of
the invariants (rating trace, UW decision, transaction/version audit trail,
form/document generation, notification intents, commission handoff events)
that every *real* policy has — and worse, could silently corrupt the
timeline/segment model other features (audit UI, exposure aggregation,
bordereaux) depend on.

### The actual design: replay the real API sequence

`createOrRateQuote` → `bindQuote` → `issuePolicy` is exactly the sequence a
live user's three separate HTTP requests (`POST /quotes`, `POST
/quotes/:id/bind`, `POST /policies/:id/issue`) already drive, and each
function manages its own transaction scope internally. A legacy import can
call the same three functions directly, in sequence, driven by staged data
instead of live HTTP requests, and get every side effect a real bind/issue
gets for free: real state-machine validation, real rating, real UW
evaluation, a real transaction/version audit trail, document generation,
notification intents, commission handoff events.

**A key finding that changes the risk profile of this work**: `db:
DrizzleDB` is declared as the first parameter of `createOrRateQuote` and
`bindQuote`, but neither function ever reads it — both open their own fresh
`withTenantTx(tenantId, ...)` internally for every write. Passing a dummy
value for that parameter is safe and is already the established pattern in
this codebase's own integration tests
(`server/src/__tests__/reinsurance-lifecycle-wiring.integration.test.ts`
calls both this way). **`issuePolicy` is different** — it uses its `db`
parameter directly (`const q = toRawQuery(db)`, plus passes `db` on to
`updatePolicyProjection`/`createPolicyNotificationIntent`/
`createCommissionHandoffEvent`), so it genuinely needs a real `DrizzleDB`.
This is why the previous attempt's investigation into "the import service
only has a `QueryFn`, not a `DrizzleDB`" was a real observation, but the fix
is narrow: thread the real `db` through only as far as the one call that
needs it, not refactor the whole service layer's plumbing.

### Staged row payload shape

Mirroring the customer entity type's existing convention (payload shape
matches what the live API accepts, `externalIdentifiers` nested inside
`payload`):

```json
{
  "payload": {
    "externalIdentifiers": [{ "sourceSystem": "LegacyPAS", "externalId": "POL-000123" }],
    "quote": { "productCode": "...", "effectiveDate": "...", "termMonths": 12, "state": "...", "applicant": {...}, "risks": [...], "coverages": [...] }
  }
}
```

`quote` is validated with the exact same `validateQuoteDetailed` contract
validator `createOrRateQuote` itself enforces — reused, not duplicated,
matching the customer handler's `validateCustomerPayload` reuse pattern.

### Why policy import is not an upsert

Re-importing the same `sourceSystem`/`externalId` pair for a customer
updates the existing record because a customer is simple master data with
no lifecycle. A policy is not: "updating" an already-issued policy by
re-running create→bind→issue would either fail immediately (the state
machine only allows `issue` from `Bound`, not from `Issued`) or, if somehow
forced, would fabricate a second bind/issue transaction pair for a policy
that already has one — corrupting its audit trail. The correct behavior for
a duplicate policy import is: **detect it via `import_external_refs` before
attempting anything, and treat the row as already-committed** (recorded
with a `skipped` outcome, pointing at the existing `policyId`), not attempt
a second create→bind→issue run. A genuine change to an already-imported
policy is a servicing transaction (endorsement, cancellation, etc.), which
is out of scope for this import framework — exactly as it would be for a
policy created through the live UI.

### Effective dates

`createOrRateQuote`/`bindQuote` do not reject a past `effectiveDate` — real
carriers bind policies with backdated effective dates in normal operation
(this is exercised elsewhere in the test suite), so no new backdating logic
is needed for legacy import specifically.

### Commit failure handling

Unchanged from the existing generic pattern: `commitImportBatch`'s
try/catch around each row's commit handler already marks a thrown error as
`Failed` with `error_message` and continues to the next row. A quote that
fails contract validation, a bind that hits `UW_DECLINED`, or any other
domain error from the real service layer surfaces exactly the same way a
`customer` commit failure does today — no policy-specific exception
handling is needed. A UW referral/decline outcome under this system's
*current* rules for historically-issued data is treated as a legitimate
review signal, not suppressed — it means the legacy row and this system's
present rating/UW configuration disagree, which is exactly the kind of
mismatch an operator reviewing `Failed` rows should see.

## Recommended smallest first slice

Everything in "Policy commit handler design" above, scoped to: a single
`quote` → `bind` → `issue` happy path per row, `import_external_refs`-based
duplicate detection, and the same validation-reuse/tenant-isolation
guarantees the customer handler already has. Explicitly **not** in this
slice (documented as deferred, consistent with how customer-only was
deferred from the original framework):

- Importing a policy at `Bound` (not yet `Issued`) status — the framework
  can be extended to accept a `targetStatus` field later if a real carrier
  migration needs mid-bind imports; today's assumption is that a legacy
  book import is importing already-issued business.
- Importing policy servicing/transaction *history* (`transaction_history`
  entity type stays framework-only) — this issue closes the "can a carrier
  migrate its in-force book" gap; historical replay of every prior
  endorsement/renewal on each policy is materially larger scope.
- Bulk file (CSV/Excel) upload parsing — unchanged from the original
  framework's deferral; batches are staged via a JSON array of rows.

## Follow-up implementable issues

- A `targetStatus: 'Bound' | 'Issued'` option on staged policy rows, if a
  carrier migration needs to import in-flight (not-yet-issued) business.
- `agency`/`producer` entity types, which (like customer) are simple master
  data without a lifecycle state machine and should follow the customer
  pattern directly.
- `transaction_history` entity type — deliberately out of scope here; needs
  its own design pass since it means replaying arbitrary prior servicing
  transactions against an already-imported policy, not just creating one.
- Moving `commitImportBatch` to the job queue framework (#57, since merged)
  for very large batches, per the original framework's existing follow-up
  note — unaffected by adding policy as a second entity type.
